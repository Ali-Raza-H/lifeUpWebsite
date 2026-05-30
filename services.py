from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date, datetime, timedelta
import math

from database import execute_db, query_db
from utils import parse_datetime, row_to_dict, rows_to_dicts

DEFAULT_TRAITS = [
    ("Systems Thinking", 95, "cognitive", 1),
    ("Perfectionism", 90, "behavioral", 2),
    ("Self-Reliance", 85, "behavioral", 3),
    ("Curiosity", 99, "cognitive", 4),
    ("Execution", 60, "behavioral", 5),
]

DEFAULT_BELIEFS = [
    ("Uncompromising Standards", "Protect quality, but ship before perfection becomes avoidance.", 1),
    ("Self-Reliance", "Build systems that reduce friction instead of waiting for ideal conditions.", 2),
    ("Equivalent Exchange", "Meaningful progress usually requires time, focus, or comfort in return.", 3),
]

DEFAULT_SKILLS = [
    ("Python", "language", 88, "advanced", "Primary automation and backend language.", 1),
    ("JavaScript", "language", 78, "advanced", "Frontend logic and browser tooling.", 2),
    ("Flask", "framework", 80, "advanced", "Fast internal tools and lightweight web apps.", 3),
    ("SQL / SQLite", "database", 74, "intermediate", "Schema design, querying, and local persistence.", 4),
    ("Git", "tool", 82, "advanced", "Branching, history control, and release workflows.", 5),
]


def seed_profile_defaults() -> None:
    trait_count = query_db("SELECT COUNT(*) AS count FROM traits", one=True)["count"]
    if trait_count == 0:
        for trait in DEFAULT_TRAITS:
            execute_db("INSERT INTO traits (name, score, category, display_order) VALUES (?, ?, ?, ?)", trait)

    belief_count = query_db("SELECT COUNT(*) AS count FROM beliefs", one=True)["count"]
    if belief_count == 0:
        for belief in DEFAULT_BELIEFS:
            execute_db(
                "INSERT INTO beliefs (title, text, display_order) VALUES (?, ?, ?)",
                belief,
            )

    skill_count = query_db("SELECT COUNT(*) AS count FROM skills", one=True)["count"]
    if skill_count == 0:
        for skill in DEFAULT_SKILLS:
            execute_db(
                """
                INSERT INTO skills (name, category, proficiency, experience_level, notes, display_order)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                skill,
            )

    normalize_profile_orders()


def normalize_profile_orders() -> None:
    _normalize_display_order(
        "traits",
        "ORDER BY COALESCE(display_order, 0) ASC, score DESC, name ASC, id ASC",
    )
    _normalize_display_order(
        "beliefs",
        "ORDER BY COALESCE(display_order, 0) ASC, id ASC",
    )
    _normalize_display_order(
        "skills",
        "ORDER BY COALESCE(display_order, 0) ASC, proficiency DESC, name ASC, id ASC",
    )


def _normalize_display_order(table_name: str, order_clause: str) -> None:
    rows = rows_to_dicts(query_db(f"SELECT id, display_order FROM {table_name} {order_clause}"))
    for index, row in enumerate(rows, start=1):
        if int(row.get("display_order") or 0) == index:
            continue
        execute_db(f"UPDATE {table_name} SET display_order = ? WHERE id = ?", (index, row["id"]))


def get_traits_payload() -> list[dict]:
    seed_profile_defaults()
    rows = query_db(
        """
        SELECT *
        FROM traits
        ORDER BY display_order ASC, score DESC, name ASC, id ASC
        """
    )
    return rows_to_dicts(rows)


def get_beliefs_payload() -> list[dict]:
    seed_profile_defaults()
    rows = query_db(
        """
        SELECT *
        FROM beliefs
        ORDER BY display_order ASC, id ASC
        """
    )
    return rows_to_dicts(rows)


def _group_habit_logs(habit_ids: list[int]) -> dict[int, list[dict]]:
    if not habit_ids:
        return {}

    placeholders = ",".join("?" for _ in habit_ids)
    rows = query_db(
        f"""
        SELECT habit_id, log_date, status
        FROM habit_logs
        WHERE habit_id IN ({placeholders})
        ORDER BY log_date DESC
        """,
        habit_ids,
    )
    grouped: dict[int, list[dict]] = defaultdict(list)
    for row in rows_to_dicts(rows):
        grouped[row["habit_id"]].append(row)
    return grouped


def resolve_month(month_value: str | None = None) -> date:
    today = date.today()
    if not month_value:
        return today.replace(day=1)

    try:
        parsed = datetime.strptime(month_value, "%Y-%m").date()
    except ValueError as exc:
        raise ValueError("Month must use YYYY-MM format.") from exc

    month_start = parsed.replace(day=1)
    if month_start > today.replace(day=1):
        raise ValueError("Future months are not available.")
    return month_start


def month_bounds(month_start: date) -> tuple[date, date]:
    _, days_in_month = calendar.monthrange(month_start.year, month_start.month)
    month_end = month_start.replace(day=days_in_month)
    return month_start, month_end


def shift_month(month_start: date, delta: int) -> date:
    year = month_start.year
    month = month_start.month + delta
    while month < 1:
        month += 12
        year -= 1
    while month > 12:
        month -= 12
        year += 1
    return date(year, month, 1)


def _expected_periods(
    frequency: str,
    created_at: str | None,
    days: int,
    earliest_log_date: date | None = None,
) -> int:
    today = date.today()
    created_date = _coerce_date(created_at) or today
    if earliest_log_date and earliest_log_date < created_date:
        created_date = earliest_log_date
    active_days = min(days, max(1, (today - created_date).days + 1))

    if frequency == "weekly":
        return max(1, math.ceil(active_days / 7))
    if frequency == "monthly":
        return max(1, math.ceil(active_days / 30))
    return active_days


def _month_target_days(
    month_start: date,
    month_end: date,
    created_at: str | None,
    earliest_log_date: date | None = None,
) -> int:
    created_date = _coerce_date(created_at) or month_start
    if earliest_log_date and earliest_log_date < created_date:
        created_date = earliest_log_date

    today = date.today()
    track_start = max(created_date, month_start)
    track_end = min(month_end, today)
    if track_end < track_start:
        return 0
    return (track_end - track_start).days + 1


def _coerce_date(value: str | None) -> date | None:
    if not value:
        return None

    normalized = value.split(" ")[0]
    try:
        return date.fromisoformat(normalized)
    except ValueError:
        return None


def _week_key(log_date: date) -> tuple[int, int]:
    iso_year, iso_week, _ = log_date.isocalendar()
    return iso_year, iso_week


def _month_key(log_date: date) -> tuple[int, int]:
    return log_date.year, log_date.month


def calculate_streak(frequency: str, completed_dates: set[date]) -> int:
    if not completed_dates:
        return 0

    today = date.today()

    if frequency == "weekly":
        streak = 0
        week_marker = _week_key(today)
        checked_dates = {_week_key(item) for item in completed_dates}
        year, week = week_marker
        while (year, week) in checked_dates:
            streak += 1
            current = datetime.fromisocalendar(year, week, 1).date() - timedelta(days=7)
            year, week = _week_key(current)
        return streak

    if frequency == "monthly":
        streak = 0
        year, month = _month_key(today)
        checked_dates = {_month_key(item) for item in completed_dates}
        while (year, month) in checked_dates:
            streak += 1
            if month == 1:
                year -= 1
                month = 12
            else:
                month -= 1
        return streak

    streak = 0
    cursor = today
    while cursor in completed_dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _build_calendar_cells(
    month_start: date,
    month_end: date,
    log_map: dict[str, str],
    created_at: str | None,
) -> list[dict]:
    cells: list[dict] = []
    today = date.today()

    leading_blanks = month_start.weekday()
    for _ in range(leading_blanks):
        cells.append({"is_padding": True})

    cursor = month_start
    while cursor <= month_end:
        date_key = cursor.isoformat()
        is_future = cursor > today
        is_trackable = cursor <= today
        cells.append(
            {
                "is_padding": False,
                "date": date_key,
                "day": cursor.day,
                "weekday": cursor.strftime("%a"),
                "status": log_map.get(date_key, "pending" if is_trackable else None),
                "is_future": is_future,
                "is_trackable": is_trackable,
                "is_today": cursor == today,
            }
        )
        cursor += timedelta(days=1)

    while len(cells) % 7 != 0:
        cells.append({"is_padding": True})

    return cells


def serialize_habits_with_metrics(days: int = 30) -> list[dict]:
    habits = rows_to_dicts(query_db("SELECT * FROM habits ORDER BY created_at DESC, id DESC"))
    if not habits:
        return []

    today = date.today()
    since = today - timedelta(days=max(days - 1, 0))
    habit_ids = [habit["id"] for habit in habits]
    logs_by_habit = _group_habit_logs(habit_ids)

    recent_window_start = today - timedelta(days=6)

    for habit in habits:
        logs = logs_by_habit.get(habit["id"], [])
        recent_logs: dict[str, str] = {}
        completed_dates: set[date] = set()
        completed_this_month = 0
        earliest_log_date: date | None = None

        for log in logs:
            parsed_date = _coerce_date(log["log_date"])
            if parsed_date is None:
                continue
            earliest_log_date = parsed_date if earliest_log_date is None else min(earliest_log_date, parsed_date)

            if parsed_date >= recent_window_start:
                recent_logs[parsed_date.isoformat()] = log["status"]
            if log["status"] == "completed":
                completed_dates.add(parsed_date)
                if parsed_date >= since:
                    completed_this_month += 1

        monthly_target = _expected_periods(habit["frequency"], habit.get("created_at"), 30, earliest_log_date)
        completion_rate = round((completed_this_month / monthly_target) * 100) if monthly_target else 0

        habit["recent_logs"] = recent_logs
        habit["today_status"] = recent_logs.get(today.isoformat(), "pending")
        habit["current_streak"] = calculate_streak(habit["frequency"], completed_dates)
        habit["completed_this_month"] = completed_this_month
        habit["monthly_target"] = monthly_target
        habit["completion_rate"] = min(100, completion_rate)

    return habits


def build_habit_calendar_payload(month_value: str | None = None) -> dict:
    month_start = resolve_month(month_value)
    month_start, month_end = month_bounds(month_start)
    habits = rows_to_dicts(query_db("SELECT * FROM habits ORDER BY created_at DESC, id DESC"))
    habit_ids = [habit["id"] for habit in habits]
    logs_by_habit = _group_habit_logs(habit_ids)

    enriched_habits: list[dict] = []
    for habit in habits:
        logs = logs_by_habit.get(habit["id"], [])
        log_map = {log["log_date"]: log["status"] for log in logs}

        completed_dates = {
            parsed_date
            for log in logs
            if log["status"] == "completed"
            for parsed_date in [_coerce_date(log["log_date"])]
            if parsed_date is not None
        }

        valid_log_dates = [
            parsed_date
            for log in logs
            for parsed_date in [_coerce_date(log["log_date"])]
            if parsed_date is not None
        ]
        earliest_log_date = min(valid_log_dates) if valid_log_dates else None

        target_days = _month_target_days(month_start, month_end, habit.get("created_at"), earliest_log_date)
        completed_days = sum(
            1
            for current_date, status in log_map.items()
            if status == "completed" and month_start.isoformat() <= current_date <= month_end.isoformat()
        )
        completion_rate = round((completed_days / target_days) * 100) if target_days else 0

        enriched = {
            **habit,
            "current_streak": calculate_streak(habit["frequency"], completed_dates),
            "month_completed_days": completed_days,
            "month_target_days": target_days,
            "month_completion_rate": min(100, completion_rate),
            "calendar_cells": _build_calendar_cells(month_start, month_end, log_map, habit.get("created_at")),
        }
        enriched_habits.append(enriched)

    previous_month = shift_month(month_start, -1)
    next_month = shift_month(month_start, 1)
    current_month = date.today().replace(day=1)

    return {
        "month": month_start.strftime("%Y-%m"),
        "month_label": month_start.strftime("%B %Y"),
        "previous_month": previous_month.strftime("%Y-%m"),
        "next_month": next_month.strftime("%Y-%m") if next_month <= current_month else None,
        "weekday_labels": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        "habits": enriched_habits,
    }


def get_skills_payload() -> list[dict]:
    seed_profile_defaults()
    rows = query_db(
        """
        SELECT *
        FROM skills
        ORDER BY
            display_order ASC,
            CASE category
                WHEN 'language' THEN 0
                WHEN 'framework' THEN 1
                WHEN 'tool' THEN 2
                WHEN 'database' THEN 3
                ELSE 4
            END,
            proficiency DESC,
            name ASC
        """
    )
    return rows_to_dicts(rows)


def reset_profile_defaults() -> dict[str, int]:
    execute_db("DELETE FROM skills")
    execute_db("DELETE FROM beliefs")
    execute_db("DELETE FROM traits")
    seed_profile_defaults()
    return {
        "traits": int(query_db("SELECT COUNT(*) AS count FROM traits", one=True)["count"] or 0),
        "beliefs": int(query_db("SELECT COUNT(*) AS count FROM beliefs", one=True)["count"] or 0),
        "skills": int(query_db("SELECT COUNT(*) AS count FROM skills", one=True)["count"] or 0),
    }


def resolve_week_start(week_value: str | None = None) -> date:
    today = date.today()
    if not week_value:
        return today - timedelta(days=today.weekday())

    try:
        parsed = date.fromisoformat(week_value)
    except ValueError as exc:
        raise ValueError("Week must use YYYY-MM-DD format.") from exc

    return parsed - timedelta(days=parsed.weekday())


def resolve_calendar_month(month_value: str | None = None) -> date:
    today = date.today()
    if not month_value:
        return today.replace(day=1)

    try:
        parsed = datetime.strptime(month_value, "%Y-%m").date()
    except ValueError as exc:
        raise ValueError("Month must use YYYY-MM format.") from exc

    return parsed.replace(day=1)


def _fetch_calendar_base_rows(range_start: date, range_end: date) -> list[dict]:
    start_boundary = f"{range_start.isoformat()} 00:00:00"
    end_boundary = f"{range_end.isoformat()} 23:59:59"

    rows = query_db(
        """
        SELECT
            ce.*,
            p.name AS project_name,
            g.title AS goal_title
        FROM calendar_events ce
        LEFT JOIN projects p ON p.id = ce.project_id
        LEFT JOIN goals g ON g.id = ce.goal_id
        WHERE (ce.start_at <= ? AND ce.end_at >= ?)
           OR (
                COALESCE(ce.recurrence, 'none') != 'none'
                AND ce.start_at <= ?
                AND (ce.recurrence_until IS NULL OR ce.recurrence_until >= ?)
           )
        ORDER BY ce.start_at ASC, ce.end_at ASC, ce.id ASC
        """,
        [end_boundary, start_boundary, end_boundary, range_start.isoformat()],
    )
    return rows_to_dicts(rows)


def _serialize_calendar_event_occurrence(row: dict, start_dt: datetime, end_dt: datetime, current_day: date) -> dict:
    return {
        **row,
        "start_date": current_day.isoformat(),
        "end_date": current_day.isoformat(),
        "occurrence_date": current_day.isoformat(),
        "start_time": start_dt.strftime("%H:%M"),
        "end_time": end_dt.strftime("%H:%M"),
        "start_minutes": (start_dt.hour * 60) + start_dt.minute,
        "end_minutes": (end_dt.hour * 60) + end_dt.minute,
    }


def build_week_schedule_payload(week_value: str | None = None) -> dict:
    week_start = resolve_week_start(week_value)
    week_end = week_start + timedelta(days=6)
    event_rows = _fetch_calendar_base_rows(week_start, week_end)

    days: list[dict] = []
    for offset in range(7):
        current_day = week_start + timedelta(days=offset)
        day_events = []
        for row in event_rows:
            start_dt = parse_datetime(row["start_at"])
            end_dt = parse_datetime(row["end_at"])
            if start_dt is None or end_dt is None:
                continue
            if not _calendar_event_occurs_on(row, start_dt, current_day):
                continue

            day_events.append(_serialize_calendar_event_occurrence(row, start_dt, end_dt, current_day))

        day_events.sort(key=lambda item: (item["start_minutes"], item["end_minutes"], item["id"]))

        days.append(
            {
                "date": current_day.isoformat(),
                "label": current_day.strftime("%a"),
                "day_number": current_day.day,
                "is_today": current_day == date.today(),
                "events": day_events,
            }
        )

    return {
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "week_label": f"{week_start.strftime('%d %b')} - {week_end.strftime('%d %b %Y')}",
        "previous_week": (week_start - timedelta(days=7)).isoformat(),
        "next_week": (week_start + timedelta(days=7)).isoformat(),
        "time_labels": [f"{hour:02d}:00" for hour in range(6, 24)],
        "days": days,
    }


def build_month_schedule_payload(month_value: str | None = None) -> dict:
    month_start = resolve_calendar_month(month_value)
    month_start, month_end = month_bounds(month_start)

    grid_start = month_start - timedelta(days=month_start.weekday())
    grid_end = month_end + timedelta(days=(6 - month_end.weekday()))
    event_rows = _fetch_calendar_base_rows(grid_start, grid_end)

    days: list[dict] = []
    cursor = grid_start
    while cursor <= grid_end:
        day_events = []
        for row in event_rows:
            start_dt = parse_datetime(row["start_at"])
            end_dt = parse_datetime(row["end_at"])
            if start_dt is None or end_dt is None:
                continue
            if not _calendar_event_occurs_on(row, start_dt, cursor):
                continue
            day_events.append(_serialize_calendar_event_occurrence(row, start_dt, end_dt, cursor))

        day_events.sort(key=lambda item: (item["start_minutes"], item["end_minutes"], item["id"]))
        days.append(
            {
                "date": cursor.isoformat(),
                "label": cursor.strftime("%a"),
                "day_number": cursor.day,
                "is_today": cursor == date.today(),
                "is_current_month": month_start <= cursor <= month_end,
                "events": day_events,
            }
        )
        cursor += timedelta(days=1)

    return {
        "month": month_start.strftime("%Y-%m"),
        "month_label": month_start.strftime("%B %Y"),
        "month_start": month_start.isoformat(),
        "month_end": month_end.isoformat(),
        "previous_month": shift_month(month_start, -1).strftime("%Y-%m"),
        "next_month": shift_month(month_start, 1).strftime("%Y-%m"),
        "weekday_labels": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        "days": days,
    }


def _calendar_event_occurs_on(row: dict, start_dt: datetime, current_day: date) -> bool:
    start_date = start_dt.date()
    if current_day < start_date:
        return False

    recurrence_until = row.get("recurrence_until")
    if recurrence_until:
        try:
            until_date = date.fromisoformat(str(recurrence_until)[:10])
        except ValueError:
            until_date = None
        if until_date and current_day > until_date:
            return False

    recurrence = row.get("recurrence") or "none"
    if recurrence == "none":
        return current_day == start_date
    if recurrence == "daily":
        return True
    if recurrence == "weekly":
        return (current_day - start_date).days % 7 == 0
    if recurrence == "monthly":
        return current_day.day == start_date.day
    return current_day == start_date


def fetch_project_metrics() -> list[dict]:
    rows = query_db(
        """
        SELECT
            p.*,
            COUNT(t.id) AS task_count,
            SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed_task_count,
            SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_task_count
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id
        GROUP BY p.id
        ORDER BY CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END, p.created_at DESC, p.id DESC
        """
    )

    projects = rows_to_dicts(rows)
    milestone_rows = rows_to_dicts(
        query_db(
            """
            SELECT
                project_id,
                COUNT(*) AS milestone_count,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_milestone_count,
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_milestone_count
            FROM project_milestones
            GROUP BY project_id
            """
        )
    )
    milestone_map = {row["project_id"]: row for row in milestone_rows}
    for project in projects:
        project["task_count"] = int(project["task_count"] or 0)
        project["completed_task_count"] = int(project["completed_task_count"] or 0)
        project["in_progress_task_count"] = int(project["in_progress_task_count"] or 0)
        milestone_metrics = milestone_map.get(project["id"], {})
        project["milestone_count"] = int(milestone_metrics.get("milestone_count") or 0)
        project["completed_milestone_count"] = int(milestone_metrics.get("completed_milestone_count") or 0)
        project["in_progress_milestone_count"] = int(milestone_metrics.get("in_progress_milestone_count") or 0)
        project["progress"] = calculate_progress(
            project["task_count"] + project["milestone_count"],
            project["completed_task_count"] + project["completed_milestone_count"],
            project["in_progress_task_count"] + project["in_progress_milestone_count"],
            project["status"] == "completed",
        )
        project["health"] = project_health(project)
    return projects


def fetch_goal_metrics() -> list[dict]:
    rows = query_db(
        """
        SELECT
            g.*,
            COUNT(t.id) AS task_count,
            SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed_task_count,
            SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_task_count
        FROM goals g
        LEFT JOIN tasks t ON t.goal_id = g.id
        GROUP BY g.id
        ORDER BY CASE WHEN g.status = 'completed' THEN 1 ELSE 0 END, g.created_at DESC, g.id DESC
        """
    )

    goals = rows_to_dicts(rows)
    milestone_rows = rows_to_dicts(
        query_db(
            """
            SELECT *
            FROM goal_milestones
            ORDER BY
                CASE status WHEN 'completed' THEN 1 ELSE 0 END,
                COALESCE(due_date, '9999-12-31') ASC,
                created_at DESC,
                id DESC
            """
        )
    )
    milestones_by_goal: dict[int, list[dict]] = defaultdict(list)
    for milestone in milestone_rows:
        milestones_by_goal[milestone["goal_id"]].append(milestone)

    milestone_metric_rows = rows_to_dicts(
        query_db(
            """
            SELECT
                goal_id,
                COUNT(*) AS milestone_count,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_milestone_count,
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_milestone_count
            FROM goal_milestones
            GROUP BY goal_id
            """
        )
    )
    milestone_map = {row["goal_id"]: row for row in milestone_metric_rows}
    goal_link_rows = rows_to_dicts(
        query_db(
            """
            SELECT *
            FROM goal_links
            ORDER BY created_at DESC, id DESC
            """
        )
    )
    goal_links_by_goal: dict[int, list[dict]] = defaultdict(list)
    for link in goal_link_rows:
        goal_links_by_goal[link["goal_id"]].append(link)

    project_rows = rows_to_dicts(
        query_db(
            """
            SELECT goal_id, COUNT(*) AS project_count
            FROM projects
            WHERE goal_id IS NOT NULL
            GROUP BY goal_id
            """
        )
    )
    project_map = {row["goal_id"]: int(row["project_count"] or 0) for row in project_rows}
    for goal in goals:
        goal["task_count"] = int(goal["task_count"] or 0)
        goal["completed_task_count"] = int(goal["completed_task_count"] or 0)
        goal["in_progress_task_count"] = int(goal["in_progress_task_count"] or 0)
        milestone_metrics = milestone_map.get(goal["id"], {})
        goal["milestone_count"] = int(milestone_metrics.get("milestone_count") or 0)
        goal["completed_milestone_count"] = int(milestone_metrics.get("completed_milestone_count") or 0)
        goal["in_progress_milestone_count"] = int(milestone_metrics.get("in_progress_milestone_count") or 0)
        goal["milestones"] = milestones_by_goal.get(goal["id"], [])
        goal["project_count"] = project_map.get(goal["id"], 0)
        goal["links"] = goal_links_by_goal.get(goal["id"], [])
        goal["link_count"] = len(goal["links"])
        goal["progress"] = calculate_progress(
            goal["task_count"] + goal["milestone_count"],
            goal["completed_task_count"] + goal["completed_milestone_count"],
            goal["in_progress_task_count"] + goal["in_progress_milestone_count"],
            goal["status"] == "completed",
        )
    return goals


def calculate_progress(total_count: int, completed_count: int, in_progress_count: int, is_completed: bool) -> int:
    if is_completed:
        return 100
    if total_count <= 0:
        return 0
    weighted_done = completed_count + (in_progress_count * 0.5)
    return round((weighted_done / total_count) * 100)


def activity_series(days: int = 7) -> dict[str, list]:
    today = date.today()
    start_date = today - timedelta(days=max(days - 1, 0))

    habit_rows = query_db(
        """
        SELECT log_date AS event_date, COUNT(*) AS count
        FROM habit_logs
        WHERE status = 'completed' AND log_date >= ?
        GROUP BY log_date
        """,
        [start_date.isoformat()],
    )
    journal_rows = query_db(
        """
        SELECT DATE(entry_date) AS event_date, COUNT(*) AS count
        FROM journal_entries
        WHERE DATE(entry_date) >= ?
        GROUP BY DATE(entry_date)
        """,
        [start_date.isoformat()],
    )
    task_rows = query_db(
        """
        SELECT DATE(completed_at) AS event_date, COUNT(*) AS count
        FROM tasks
        WHERE completed_at IS NOT NULL AND DATE(completed_at) >= ?
        GROUP BY DATE(completed_at)
        """,
        [start_date.isoformat()],
    )

    counts: dict[str, int] = defaultdict(int)
    for row in (*habit_rows, *journal_rows, *task_rows):
        counts[row["event_date"]] += int(row["count"] or 0)

    labels: list[str] = []
    values: list[int] = []
    for offset in range(days):
        current = start_date + timedelta(days=offset)
        labels.append(current.strftime("%a"))
        values.append(counts.get(current.isoformat(), 0))

    return {"labels": labels, "values": values}


def weekly_completion_series(weeks: int = 4) -> dict[str, list]:
    today = date.today()
    current_week_start = today - timedelta(days=today.weekday())
    labels: list[str] = []
    values: list[int] = []

    for offset in range(weeks - 1, -1, -1):
        week_start = current_week_start - timedelta(days=offset * 7)
        week_end = week_start + timedelta(days=6)
        row = query_db(
            """
            SELECT COUNT(*) AS count
            FROM tasks
            WHERE completed_at IS NOT NULL
              AND DATE(completed_at) BETWEEN ? AND ?
            """,
            [week_start.isoformat(), week_end.isoformat()],
            one=True,
        )
        labels.append(week_start.strftime("Wk %d %b"))
        values.append(int(row["count"] or 0))

    return {"labels": labels, "values": values}


def consistency_rate() -> int:
    habits = build_habit_calendar_payload()["habits"]
    if not habits:
        return 0

    total_completed = sum(min(habit["month_completed_days"], habit["month_target_days"]) for habit in habits)
    total_target = sum(habit["month_target_days"] for habit in habits)
    if total_target == 0:
        return 0
    return round((total_completed / total_target) * 100)


def project_health(project: dict) -> str:
    if project.get("status") == "completed":
        return "done"
    deadline = _coerce_date(project.get("deadline"))
    today = date.today()
    if deadline and deadline < today:
        return "off_track"
    if deadline and (deadline - today).days <= 7:
        return "at_risk"
    if (project.get("in_progress_task_count") or 0) > 0:
        return "on_track"
    return "planning"


def dashboard_today_payload() -> dict:
    today = date.today().isoformat()
    now = datetime.now().replace(second=0, microsecond=0)
    now_iso = now.isoformat(sep=" ")

    due_today = int(
        query_db(
            """
            SELECT COUNT(*) AS count
            FROM tasks
            WHERE status != 'completed'
              AND due_date IS NOT NULL
              AND DATE(due_date) = ?
            """,
            [today],
            one=True,
        )["count"]
        or 0
    )
    overdue_tasks = int(
        query_db(
            """
            SELECT COUNT(*) AS count
            FROM tasks
            WHERE status != 'completed'
              AND due_date IS NOT NULL
              AND DATE(due_date) < ?
            """,
            [today],
            one=True,
        )["count"]
        or 0
    )
    open_habit_count = int(
        query_db(
            """
            SELECT COUNT(*) AS count
            FROM habits h
            LEFT JOIN habit_logs hl
              ON hl.habit_id = h.id
             AND hl.log_date = ?
             AND hl.status = 'completed'
            WHERE hl.id IS NULL
            """,
            [today],
            one=True,
        )["count"]
        or 0
    )
    next_event_row = query_db(
        """
        SELECT
            ce.*,
            p.name AS project_name,
            g.title AS goal_title
        FROM calendar_events ce
        LEFT JOIN projects p ON p.id = ce.project_id
        LEFT JOIN goals g ON g.id = ce.goal_id
        WHERE ce.end_at >= ?
        ORDER BY ce.start_at ASC
        LIMIT 1
        """,
        [now_iso],
        one=True,
    )
    next_event = row_to_dict(next_event_row)

    focus_tasks = rows_to_dicts(
        query_db(
            """
            SELECT *
            FROM tasks
            WHERE status IN ('pending', 'in_progress', 'on_hold')
            ORDER BY
                CASE WHEN DATE(due_date) = ? THEN 0 WHEN due_date IS NULL THEN 2 ELSE 1 END,
                priority ASC,
                COALESCE(due_date, '9999-12-31') ASC,
                created_at DESC
            LIMIT 5
            """,
            [today],
        )
    )

    return {
        "due_today": due_today,
        "overdue_tasks": overdue_tasks,
        "open_habits": open_habit_count,
        "next_event": next_event,
        "focus_tasks": focus_tasks,
    }


def mood_productivity_series(days: int = 14) -> dict[str, list]:
    today = date.today()
    start_date = today - timedelta(days=max(days - 1, 0))
    mood_rows = rows_to_dicts(
        query_db(
            """
            SELECT DATE(entry_date) AS event_date, AVG(mood_score) AS avg_mood
            FROM journal_entries
            WHERE DATE(entry_date) >= ?
            GROUP BY DATE(entry_date)
            """,
            [start_date.isoformat()],
        )
    )
    task_rows = rows_to_dicts(
        query_db(
            """
            SELECT DATE(completed_at) AS event_date, COUNT(*) AS completed_tasks
            FROM tasks
            WHERE completed_at IS NOT NULL AND DATE(completed_at) >= ?
            GROUP BY DATE(completed_at)
            """,
            [start_date.isoformat()],
        )
    )

    mood_map = {row["event_date"]: round(float(row["avg_mood"] or 0), 2) for row in mood_rows}
    task_map = {row["event_date"]: int(row["completed_tasks"] or 0) for row in task_rows}
    labels: list[str] = []
    mood_values: list[float | None] = []
    task_values: list[int] = []
    for offset in range(days):
        current = start_date + timedelta(days=offset)
        key = current.isoformat()
        labels.append(current.strftime("%d %b"))
        mood_values.append(mood_map.get(key))
        task_values.append(task_map.get(key, 0))
    return {"labels": labels, "mood": mood_values, "tasks": task_values}
