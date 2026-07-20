from __future__ import annotations

from datetime import date, datetime, timedelta
from flask import Blueprint, jsonify, request

from database import query_db
from modules import modules_for_commands
from services import dashboard_today_payload
from utils import parse_datetime, row_to_dict, rows_to_dicts

bp = Blueprint("os_api", __name__, url_prefix="/api/os")

DAY2DAY_HABITS_URL = "/day2day#habits"
DAY2DAY_TASKS_URL = "/day2day#tasks"
DAY2DAY_CALENDAR_URL = "/day2day#calendar"
BUILD_PROJECTS_URL = "/build#projects"
BUILD_GOALS_URL = "/build#goals"
BUILD_WORK_URL = "/build#work"
BUILD_CV_URL = "/build#cv"


def _command_result(
    *,
    item_type: str,
    title: str,
    subtitle: str = "",
    action_url: str = "#",
    action_type: str = "navigate",
    source_id: int | None = None,
    icon: str = "ph ph-circle",
    meta: dict | None = None,
) -> dict:
    return {
        "type": item_type,
        "title": title,
        "subtitle": subtitle,
        "action_url": action_url,
        "action_type": action_type,
        "source_id": source_id,
        "icon": icon,
        "meta": meta or {},
    }


def _compact_parts(*parts: object) -> str:
    return " - ".join(str(part) for part in parts if part not in (None, ""))


def _format_date(value: str | None) -> str:
    parsed = parse_datetime(value)
    return parsed.strftime("%d %b") if parsed else ""


def _format_event_window(event: dict) -> str:
    start_at = parse_datetime(event.get("start_at"))
    end_at = parse_datetime(event.get("end_at"))
    if not start_at:
        return ""
    if not end_at:
        return start_at.strftime("%d %b %H:%M")
    return f"{start_at.strftime('%d %b %H:%M')}-{end_at.strftime('%H:%M')}"


def _page_commands() -> list[dict]:
    return [
        _command_result(
            item_type="page",
            title=module.title,
            subtitle=module.subtitle,
            action_url=module.url,
            icon=module.icon,
        )
        for module in modules_for_commands()
        if module.sidebar_visible
    ]


def _section_commands() -> list[dict]:
    sections = (
        ("Day2Day: Habits", "Open the habits section inside the daily workspace.", DAY2DAY_HABITS_URL, "ph ph-calendar-check"),
        ("Day2Day: Tasks", "Open the tasks section inside the daily workspace.", DAY2DAY_TASKS_URL, "ph ph-list-checks"),
        ("Day2Day: Calendar", "Open the calendar section inside the daily workspace.", DAY2DAY_CALENDAR_URL, "ph ph-calendar-blank"),
        ("Build: Projects", "Open the projects area inside the build hub.", BUILD_PROJECTS_URL, "ph ph-kanban"),
        ("Build: Goals", "Open the goals area inside the build hub.", BUILD_GOALS_URL, "ph ph-target"),
        ("Build: Work", "Open the work area inside the build hub.", BUILD_WORK_URL, "ph ph-briefcase"),
        ("Build: CV", "Open the CV area inside the build hub.", BUILD_CV_URL, "ph ph-file-text"),
        ("Life: Health Hub", "Jump to the Life health hub.", "/life#health", "ph ph-heartbeat"),
        ("Life: Gym", "Jump to the gym planner and workout logs.", "/life#health-gym", "ph ph-barbell"),
        ("Life: Diet", "Jump to diet targets and meal logs.", "/life#health-diet", "ph ph-bowl-food"),
        ("Life: Health Logs", "Jump to health logs.", "/life#health-logs", "ph ph-clipboard-text"),
        ("Life: Finance", "Jump to finance dashboard and history.", "/life#finance", "ph ph-wallet"),
        ("Life: Relationships", "Jump to contacts and follow-ups.", "/life#contacts", "ph ph-users-three"),
        ("Life: Reviews", "Jump to life reviews.", "/life#reviews", "ph ph-clipboard-text"),
        ("Life: Resources", "Jump to saved resources and links.", "/life#attachments", "ph ph-paperclip"),
    )
    return [
        _command_result(
            item_type="section",
            title=title,
            subtitle=subtitle,
            action_url=url,
            icon=icon,
        )
        for title, subtitle, url, icon in sections
    ]


def _default_command_results(limit: int) -> list[dict]:
    results = [
        _command_result(
            item_type="command",
            title="Quick add anything",
            subtitle="Create tasks, meals, events, notes, contacts, library items, work entries, and more.",
            action_url="/?quick_add=1",
            action_type="quick_add",
            icon="ph ph-plus-circle",
        ),
        _command_result(
            item_type="command",
            title="Review the week",
            subtitle="Open the dashboard weekly review panel.",
            action_url="/#weekly-review-panel",
            icon="ph ph-calendar-check",
        ),
    ]
    results.extend(_page_commands())
    results.extend(_section_commands())

    task_rows = rows_to_dicts(
        query_db(
            """
            SELECT id, title, status, priority, due_date
            FROM tasks
            WHERE status != 'completed'
            ORDER BY
                CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
                COALESCE(due_date, '9999-12-31') ASC,
                priority ASC,
                created_at DESC,
                id DESC
            LIMIT 5
            """
        )
    )
    for task in task_rows:
        results.append(
            _command_result(
                item_type="task",
                title=task["title"],
                subtitle=_compact_parts(task["status"].replace("_", " "), f"Due {_format_date(task.get('due_date'))}" if task.get("due_date") else "No due date"),
                action_url=DAY2DAY_TASKS_URL,
                source_id=task["id"],
                icon="ph ph-list-checks",
                meta={"priority": task.get("priority"), "status": task.get("status")},
            )
        )

    project_rows = rows_to_dicts(
        query_db(
            """
            SELECT id, name, status, deadline
            FROM projects
            WHERE status NOT IN ('completed', 'archived')
            ORDER BY COALESCE(deadline, '9999-12-31') ASC, created_at DESC, id DESC
            LIMIT 4
            """
        )
    )
    for project in project_rows:
        results.append(
            _command_result(
                item_type="project",
                title=project["name"],
                subtitle=_compact_parts(project.get("status"), f"Deadline {_format_date(project.get('deadline'))}" if project.get("deadline") else "No deadline"),
                action_url=BUILD_PROJECTS_URL,
                source_id=project["id"],
                icon="ph ph-kanban",
            )
        )

    return results[:limit]


def _search_table_results(query_text: str, limit: int) -> list[dict]:
    needle = f"%{query_text.lower()}%"
    results: list[dict] = []
    section_matches = [
        result
        for result in _section_commands()
        if query_text.lower() in f"{result['title']} {result['subtitle']} {result['type']}".lower()
    ]
    results.extend(section_matches[:6])

    tasks = rows_to_dicts(
        query_db(
            """
            SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date, p.name AS project_name
            FROM tasks t
            LEFT JOIN projects p ON p.id = t.project_id
            WHERE LOWER(t.title || ' ' || COALESCE(t.description, '') || ' ' || COALESCE(p.name, '')) LIKE ?
            ORDER BY
                CASE t.status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 WHEN 'on_hold' THEN 2 ELSE 3 END,
                t.priority ASC,
                COALESCE(t.due_date, '9999-12-31') ASC,
                t.created_at DESC
            LIMIT 8
            """,
            [needle],
        )
    )
    for task in tasks:
        results.append(
            _command_result(
                item_type="task",
                title=task["title"],
                subtitle=_compact_parts(task.get("project_name"), task["status"].replace("_", " "), f"Due {_format_date(task.get('due_date'))}" if task.get("due_date") else ""),
                action_url=DAY2DAY_TASKS_URL,
                source_id=task["id"],
                icon="ph ph-list-checks",
                meta={"priority": task.get("priority"), "status": task.get("status")},
            )
        )

    projects = rows_to_dicts(
        query_db(
            """
            SELECT id, name, description, status, deadline
            FROM projects
            WHERE LOWER(name || ' ' || COALESCE(description, '') || ' ' || COALESCE(notes, '')) LIKE ?
            ORDER BY
                CASE status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
                COALESCE(deadline, '9999-12-31') ASC,
                created_at DESC
            LIMIT 6
            """,
            [needle],
        )
    )
    for project in projects:
        results.append(
            _command_result(
                item_type="project",
                title=project["name"],
                subtitle=_compact_parts(project.get("status"), f"Deadline {_format_date(project.get('deadline'))}" if project.get("deadline") else "No deadline"),
                action_url=BUILD_PROJECTS_URL,
                source_id=project["id"],
                icon="ph ph-kanban",
            )
        )

    goals = rows_to_dicts(
        query_db(
            """
            SELECT id, title, type, status, target_date
            FROM goals
            WHERE LOWER(title || ' ' || COALESCE(notes, '') || ' ' || COALESCE(type, '')) LIKE ?
            ORDER BY
                CASE status WHEN 'active' THEN 0 WHEN 'completed' THEN 2 ELSE 1 END,
                COALESCE(target_date, '9999-12-31') ASC,
                created_at DESC
            LIMIT 5
            """,
            [needle],
        )
    )
    for goal in goals:
        results.append(
            _command_result(
                item_type="goal",
                title=goal["title"],
                subtitle=_compact_parts(goal.get("type"), goal.get("status"), f"Target {_format_date(goal.get('target_date'))}" if goal.get("target_date") else ""),
                action_url=BUILD_GOALS_URL,
                source_id=goal["id"],
                icon="ph ph-target",
            )
        )

    events = rows_to_dicts(
        query_db(
            """
            SELECT id, title, category, location, start_at, end_at
            FROM calendar_events
            WHERE LOWER(title || ' ' || COALESCE(description, '') || ' ' || COALESCE(category, '') || ' ' || COALESCE(location, '')) LIKE ?
            ORDER BY start_at DESC
            LIMIT 5
            """,
            [needle],
        )
    )
    for event in events:
        results.append(
            _command_result(
                item_type="event",
                title=event["title"],
                subtitle=_compact_parts(_format_event_window(event), event.get("location") or event.get("category")),
                action_url=DAY2DAY_CALENDAR_URL,
                source_id=event["id"],
                icon="ph ph-calendar-dots",
            )
        )

    notes = rows_to_dicts(
        query_db(
            """
            SELECT id, title, tags, updated_at, is_pinned
            FROM notes
            WHERE LOWER(title || ' ' || COALESCE(tags, '') || ' ' || COALESCE(content, '')) LIKE ?
            ORDER BY is_pinned DESC, updated_at DESC, id DESC
            LIMIT 5
            """,
            [needle],
        )
    )
    for note in notes:
        results.append(
            _command_result(
                item_type="note",
                title=note["title"],
                subtitle=_compact_parts("Pinned" if note.get("is_pinned") else "", note.get("tags"), f"Updated {_format_date(note.get('updated_at'))}"),
                action_url="/notes",
                source_id=note["id"],
                icon="ph ph-notepad",
            )
        )

    journal_entries = rows_to_dicts(
        query_db(
            """
            SELECT id, title, tags, mood_score, entry_date
            FROM journal_entries
            WHERE LOWER(COALESCE(title, '') || ' ' || COALESCE(tags, '') || ' ' || COALESCE(content, '')) LIKE ?
            ORDER BY entry_date DESC, id DESC
            LIMIT 5
            """,
            [needle],
        )
    )
    for entry in journal_entries:
        title = entry.get("title") or f"Journal entry {_format_date(entry.get('entry_date'))}"
        results.append(
            _command_result(
                item_type="journal",
                title=title,
                subtitle=_compact_parts(_format_date(entry.get("entry_date")), f"Mood {entry['mood_score']}/10" if entry.get("mood_score") else "", entry.get("tags")),
                action_url="/journal",
                source_id=entry["id"],
                icon="ph ph-book-open",
            )
        )

    contacts = rows_to_dicts(
        query_db(
            """
            SELECT id, name, relation, priority, next_follow_up
            FROM contacts
            WHERE LOWER(name || ' ' || COALESCE(relation, '') || ' ' || COALESCE(notes, '')) LIKE ?
            ORDER BY
                CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                COALESCE(next_follow_up, '9999-12-31') ASC,
                updated_at DESC
            LIMIT 5
            """,
            [needle],
        )
    )
    for contact in contacts:
        results.append(
            _command_result(
                item_type="contact",
                title=contact["name"],
                subtitle=_compact_parts(contact.get("relation"), contact.get("priority"), f"Follow up {_format_date(contact.get('next_follow_up'))}" if contact.get("next_follow_up") else ""),
                action_url="/life",
                source_id=contact["id"],
                icon="ph ph-users",
            )
        )

    resources = rows_to_dicts(
        query_db(
            """
            SELECT id, title, entity_type, url, is_favorite
            FROM attachments
            WHERE LOWER(title || ' ' || COALESCE(notes, '') || ' ' || COALESCE(url, '')) LIKE ?
            ORDER BY is_favorite DESC, created_at DESC, id DESC
            LIMIT 5
            """,
            [needle],
        )
    )
    for resource in resources:
        results.append(
            _command_result(
                item_type="resource",
                title=resource["title"],
                subtitle=_compact_parts("Favorite" if resource.get("is_favorite") else "", resource.get("entity_type"), resource.get("url")),
                action_url="/life",
                source_id=resource["id"],
                icon="ph ph-paperclip",
            )
        )

    media_items = rows_to_dicts(
        query_db(
            """
            SELECT id, title, media_type, status, creator
            FROM media_items
            WHERE LOWER(title || ' ' || COALESCE(creator, '') || ' ' || COALESCE(platform, '') || ' ' || COALESCE(notes, '')) LIKE ?
            ORDER BY updated_at DESC, id DESC
            LIMIT 5
            """,
            [needle],
        )
    )
    for media in media_items:
        results.append(
            _command_result(
                item_type="library",
                title=media["title"],
                subtitle=_compact_parts(media.get("media_type"), media.get("status"), media.get("creator")),
                action_url="/library",
                source_id=media["id"],
                icon="ph ph-books",
            )
        )

    work_items = rows_to_dicts(
        query_db(
            """
            SELECT id, title, organization, status, experience_type
            FROM work_experiences
            WHERE LOWER(title || ' ' || organization || ' ' || COALESCE(skills, '') || ' ' || COALESCE(notes, '')) LIKE ?
            ORDER BY updated_at DESC, id DESC
            LIMIT 5
            """,
            [needle],
        )
    )
    for work in work_items:
        results.append(
            _command_result(
                item_type="work",
                title=work["title"],
                subtitle=_compact_parts(work.get("organization"), work.get("experience_type"), work.get("status")),
                action_url=BUILD_WORK_URL,
                source_id=work["id"],
                icon="ph ph-briefcase",
            )
        )

    admired_people = rows_to_dicts(
        query_db(
            """
            SELECT id, name, role_or_context, traits_to_model
            FROM admired_people
            WHERE LOWER(name || ' ' || COALESCE(role_or_context, '') || ' ' || COALESCE(why_admired, '') || ' ' || COALESCE(traits_to_model, '')) LIKE ?
            ORDER BY display_order ASC, id ASC
            LIMIT 5
            """,
            [needle],
        )
    )
    for person in admired_people:
        results.append(
            _command_result(
                item_type="admired_person",
                title=person["name"],
                subtitle=_compact_parts(person.get("role_or_context"), person.get("traits_to_model")),
                action_url="/profile",
                source_id=person["id"],
                icon="ph ph-sparkle",
            )
        )

    cv_items = rows_to_dicts(
        query_db(
            """
            SELECT i.id, i.title, i.organization, i.skills, s.title AS section_title
            FROM cv_items i
            JOIN cv_sections s ON s.id = i.section_id
            WHERE LOWER(
                i.title || ' ' || COALESCE(i.organization, '') || ' ' || COALESCE(i.description, '') || ' ' ||
                COALESCE(i.bullets, '') || ' ' || COALESCE(i.skills, '') || ' ' || s.title
            ) LIKE ?
            ORDER BY s.display_order ASC, i.display_order ASC, i.id ASC
            LIMIT 5
            """,
            [needle],
        )
    )
    for item in cv_items:
        results.append(
            _command_result(
                item_type="cv",
                title=item["title"],
                subtitle=_compact_parts(item.get("section_title"), item.get("organization"), item.get("skills")),
                action_url=BUILD_CV_URL,
                source_id=item["id"],
                icon="ph ph-file-text",
            )
        )

    if query_text:
        results.append(
            _command_result(
                item_type="command",
                title=f"Search tasks for \"{query_text}\"",
                subtitle="Open the task board with this search.",
                action_url=DAY2DAY_TASKS_URL,
                icon="ph ph-magnifying-glass",
            )
        )

    return results[:limit]


@bp.route("/command", methods=["GET"])
def command_palette():
    query_text = request.args.get("q", "").strip()
    limit = max(1, min(request.args.get("limit", default=24, type=int), 40))
    results = _default_command_results(limit) if not query_text else _search_table_results(query_text, limit)
    return jsonify({"query": query_text, "results": results})


def _daily_plan_headline(today_payload: dict) -> dict:
    primary = today_payload.get("primary_focus") or {}
    current_event = today_payload.get("current_event") or {}
    overdue = int(today_payload.get("overdue_tasks") or 0)
    due_today = int(today_payload.get("due_today") or 0)

    if overdue and primary:
        return {
            "title": "Clear pressure before expanding scope",
            "message": f"{primary.get('title')} is the strongest first move because overdue work is creating noise.",
        }
    if current_event:
        return {
            "title": "Protect the current block",
            "message": f"{current_event.get('title')} is active now. Stay inside this block before opening a new context.",
        }
    if primary:
        return {
            "title": "One deliberate execution block",
            "message": f"Start with {primary.get('title')}. It ranks highest by due date, priority, and active backlog.",
        }
    if due_today:
        return {
            "title": "Close today's commitments",
            "message": "There is due-today work but no single task is dominating. Choose the smallest item and build momentum.",
        }
    return {
        "title": "Use open capacity intentionally",
        "message": "No urgent pressure is surfacing. Move a meaningful project forward instead of only maintaining trackers.",
    }


def _project_stall_count() -> int:
    row = query_db(
        """
        SELECT COUNT(*) AS count
        FROM projects p
        WHERE p.status NOT IN ('completed', 'archived')
          AND NOT EXISTS (
              SELECT 1 FROM tasks t
              WHERE t.project_id = p.id AND t.status != 'completed'
          )
          AND NOT EXISTS (
              SELECT 1 FROM project_milestones pm
              WHERE pm.project_id = p.id AND pm.status != 'completed'
          )
        """,
        one=True,
    )
    return int(row["count"] or 0) if row else 0


@bp.route("/daily-plan", methods=["GET"])
def daily_plan():
    today_payload = dashboard_today_payload()
    primary = today_payload.get("primary_focus") or {}
    current_event = today_payload.get("current_event") or {}
    next_event = today_payload.get("next_event") or {}
    event = current_event or next_event
    today_iso = date.today().isoformat()

    blocks: list[dict] = []
    if event:
        status_label = "Current block" if event.get("status") == "ongoing" else "Next commitment"
        blocks.append(
            {
                "label": status_label,
                "title": event.get("title") or "Scheduled block",
                "description": _compact_parts(_format_event_window(event), event.get("location") or event.get("category"), f"{event.get('related_open_task_count', 0)} linked tasks" if event.get("related_open_task_count") else ""),
                "action_url": DAY2DAY_CALENDAR_URL,
                "severity": "medium" if event.get("related_open_task_count") else "low",
            }
        )
    else:
        blocks.append(
            {
                "label": "Open schedule",
                "title": "Protect a deep work block",
                "description": "No current or upcoming event is forcing the day. Reserve time instead of letting it fragment.",
                "action_url": DAY2DAY_CALENDAR_URL,
                "severity": "low",
            }
        )

    if primary:
        blocks.append(
            {
                "label": "Primary action",
                "title": primary.get("title"),
                "description": _compact_parts(primary.get("project_name"), f"Due {_format_date(primary.get('due_date'))}" if primary.get("due_date") else "", f"{primary.get('estimated_minutes')} min" if primary.get("estimated_minutes") else "", primary.get("focus_reason", "").replace("_", " ")),
                "action_url": DAY2DAY_TASKS_URL,
                "severity": "high" if primary.get("focus_reason") in {"overdue", "due_today"} else "medium",
            }
        )

    open_habits = int(today_payload.get("open_habits") or 0)
    follow_ups = int(today_payload.get("follow_ups_due") or 0)
    if open_habits or follow_ups:
        blocks.append(
            {
                "label": "Close loops",
                "title": _compact_parts(f"{open_habits} habits open" if open_habits else "", f"{follow_ups} follow-ups due" if follow_ups else ""),
                "description": "Handle the small maintenance items before they become stale backlog.",
                "action_url": "/life" if follow_ups else DAY2DAY_HABITS_URL,
                "severity": "medium",
            }
        )

    actions: list[dict] = []
    if primary:
        actions.append({"title": f"Start: {primary.get('title')}", "detail": "Primary task chosen by priority and deadline.", "action_url": DAY2DAY_TASKS_URL})
    if event and event.get("related_open_task_count"):
        actions.append({"title": "Prep the next schedule block", "detail": f"{event.get('related_open_task_count')} related task(s) are still open.", "action_url": DAY2DAY_CALENDAR_URL})
    if open_habits:
        actions.append({"title": "Log remaining habits", "detail": ", ".join(today_payload.get("open_habit_names") or []) or "Open daily habits remain.", "action_url": DAY2DAY_HABITS_URL})
    if follow_ups:
        actions.append({"title": "Clear relationship follow-ups", "detail": f"{follow_ups} contact follow-up(s) are due.", "action_url": "/life"})
    if not actions:
        actions.append({"title": "Choose one proactive project block", "detail": "There is no urgent pressure, so add useful progress deliberately.", "action_url": BUILD_PROJECTS_URL})

    stalled_projects = _project_stall_count()
    risks: list[dict] = []
    if int(today_payload.get("overdue_tasks") or 0):
        risks.append({"title": "Overdue task pressure", "detail": f"{today_payload['overdue_tasks']} task(s) are past due.", "severity": "high", "action_url": DAY2DAY_TASKS_URL})
    if stalled_projects:
        risks.append({"title": "Projects without next actions", "detail": f"{stalled_projects} active project(s) have no open task or milestone.", "severity": "medium", "action_url": BUILD_PROJECTS_URL})
    if next_event and int(next_event.get("minutes_until_start") or 9999) <= 30 and int(next_event.get("related_open_task_count") or 0):
        risks.append({"title": "Low prep buffer", "detail": "The next event starts soon and still has linked open work.", "severity": "medium", "action_url": DAY2DAY_CALENDAR_URL})

    return jsonify(
        {
            "date": today_iso,
            "headline": _daily_plan_headline(today_payload),
            "metrics": {
                "overdue_tasks": int(today_payload.get("overdue_tasks") or 0),
                "due_today": int(today_payload.get("due_today") or 0),
                "open_habits": open_habits,
                "follow_ups_due": follow_ups,
                "remaining_events_today": int(today_payload.get("remaining_events_today") or 0),
            },
            "blocks": blocks,
            "actions": actions[:5],
            "risks": risks[:4],
        }
    )


def _period_bounds() -> tuple[date, date]:
    end_date = date.today()
    return end_date - timedelta(days=6), end_date


def _count_query(sql: str, params: list[object]) -> int:
    row = query_db(sql, params, one=True)
    return int(row["count"] or 0) if row else 0


@bp.route("/weekly-review", methods=["GET"])
def weekly_review():
    start_date, end_date = _period_bounds()
    start_iso = start_date.isoformat()
    end_iso = end_date.isoformat()

    completed_tasks = _count_query(
        "SELECT COUNT(*) AS count FROM tasks WHERE completed_at IS NOT NULL AND DATE(completed_at) BETWEEN ? AND ?",
        [start_iso, end_iso],
    )
    created_tasks = _count_query(
        "SELECT COUNT(*) AS count FROM tasks WHERE DATE(created_at) BETWEEN ? AND ?",
        [start_iso, end_iso],
    )
    overdue_tasks = _count_query(
        "SELECT COUNT(*) AS count FROM tasks WHERE status != 'completed' AND due_date IS NOT NULL AND DATE(due_date) < DATE('now')",
        [],
    )
    completed_task_rows = rows_to_dicts(
        query_db(
            """
            SELECT title, completed_at
            FROM tasks
            WHERE completed_at IS NOT NULL AND DATE(completed_at) BETWEEN ? AND ?
            ORDER BY completed_at DESC, id DESC
            LIMIT 5
            """,
            [start_iso, end_iso],
        )
    )

    habit_status_rows = rows_to_dicts(
        query_db(
            """
            SELECT status, COUNT(*) AS count
            FROM habit_logs
            WHERE log_date BETWEEN ? AND ?
            GROUP BY status
            """,
            [start_iso, end_iso],
        )
    )
    habit_counts = {row["status"]: int(row["count"] or 0) for row in habit_status_rows}
    active_habits = _count_query("SELECT COUNT(*) AS count FROM habits", [])
    possible_habit_logs = active_habits * 7
    habit_completion_rate = round((habit_counts.get("completed", 0) / possible_habit_logs) * 100) if possible_habit_logs else 0

    journal = row_to_dict(
        query_db(
            """
            SELECT COUNT(*) AS entry_count, AVG(mood_score) AS avg_mood
            FROM journal_entries
            WHERE DATE(entry_date) BETWEEN ? AND ?
            """,
            [start_iso, end_iso],
            one=True,
        )
    )
    finance = row_to_dict(
        query_db(
            """
            SELECT
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN type IN ('expense', 'subscription') THEN amount ELSE 0 END), 0) AS spending,
                COALESCE(SUM(CASE WHEN type = 'saving' THEN amount ELSE 0 END), 0) AS savings,
                COUNT(*) AS entry_count
            FROM finance_entries
            WHERE entry_date BETWEEN ? AND ?
            """,
            [start_iso, end_iso],
            one=True,
        )
    )
    health = row_to_dict(
        query_db(
            """
            SELECT
                COUNT(*) AS entry_count,
                AVG(sleep_hours) AS avg_sleep,
                AVG(energy_score) AS avg_energy,
                COALESCE(SUM(exercise_minutes), 0) AS exercise_minutes
            FROM health_logs
            WHERE log_date BETWEEN ? AND ?
            """,
            [start_iso, end_iso],
            one=True,
        )
    )
    diet = row_to_dict(
        query_db(
            """
            SELECT
                COUNT(*) AS logged_days,
                AVG(day_calories) AS avg_calories,
                AVG(day_protein) AS avg_protein
            FROM (
                SELECT entry_date, SUM(calories) AS day_calories, SUM(protein_g) AS day_protein
                FROM diet_entries
                WHERE entry_date BETWEEN ? AND ?
                GROUP BY entry_date
            )
            """,
            [start_iso, end_iso],
            one=True,
        )
    )
    contacts_due = _count_query(
        "SELECT COUNT(*) AS count FROM contacts WHERE next_follow_up IS NOT NULL AND next_follow_up <= DATE('now')",
        [],
    )
    contacts_touched = _count_query(
        "SELECT COUNT(*) AS count FROM contacts WHERE last_contacted BETWEEN ? AND ?",
        [start_iso, end_iso],
    )
    projects_completed = _count_query(
        "SELECT COUNT(*) AS count FROM projects WHERE completed_at IS NOT NULL AND DATE(completed_at) BETWEEN ? AND ?",
        [start_iso, end_iso],
    )
    projects_due_soon = _count_query(
        """
        SELECT COUNT(*) AS count
        FROM projects
        WHERE status NOT IN ('completed', 'archived')
          AND deadline IS NOT NULL
          AND DATE(deadline) BETWEEN DATE('now') AND DATE('now', '+14 days')
        """,
        [],
    )

    scorecard = [
        {"label": "Tasks finished", "value": completed_tasks, "detail": f"{created_tasks} task(s) created"},
        {"label": "Habit consistency", "value": f"{habit_completion_rate}%", "detail": f"{habit_counts.get('completed', 0)} completed logs"},
        {"label": "Journal entries", "value": int(journal.get("entry_count") or 0), "detail": f"Avg mood {round(float(journal.get('avg_mood') or 0), 1)}/10" if journal.get("avg_mood") else "No mood data"},
        {"label": "Net money", "value": round(float(finance.get("income") or 0) + float(finance.get("savings") or 0) - float(finance.get("spending") or 0), 2), "detail": f"{int(finance.get('entry_count') or 0)} finance entries"},
    ]

    wins: list[dict] = []
    if completed_tasks:
        wins.append({"title": f"{completed_tasks} tasks completed", "detail": ", ".join(task["title"] for task in completed_task_rows[:3]), "action_url": DAY2DAY_TASKS_URL})
    if projects_completed:
        wins.append({"title": f"{projects_completed} project(s) completed", "detail": "Project completion momentum showed up this week.", "action_url": BUILD_PROJECTS_URL})
    if habit_completion_rate >= 70:
        wins.append({"title": "Habit base stayed stable", "detail": f"{habit_completion_rate}% completion across active habits.", "action_url": DAY2DAY_HABITS_URL})
    if int(health.get("exercise_minutes") or 0):
        wins.append({"title": "Exercise was logged", "detail": f"{int(health.get('exercise_minutes') or 0)} minutes recorded.", "action_url": "/life"})
    if not wins:
        wins.append({"title": "Baseline captured", "detail": "There is not much completion evidence yet, but the system is ready to record it.", "action_url": "/"})

    risks: list[dict] = []
    if overdue_tasks:
        risks.append({"title": "Overdue work is accumulating", "detail": f"{overdue_tasks} task(s) are overdue.", "severity": "high", "action_url": DAY2DAY_TASKS_URL})
    if contacts_due:
        risks.append({"title": "Relationship follow-ups are due", "detail": f"{contacts_due} contact(s) need attention.", "severity": "medium", "action_url": "/life"})
    if projects_due_soon:
        risks.append({"title": "Project deadlines are close", "detail": f"{projects_due_soon} active project(s) are due within 14 days.", "severity": "medium", "action_url": BUILD_PROJECTS_URL})
    if health.get("avg_sleep") and float(health["avg_sleep"]) < 6:
        risks.append({"title": "Sleep average is low", "detail": f"{round(float(health['avg_sleep']), 1)} hours average from logged health data.", "severity": "medium", "action_url": "/life"})
    if not risks:
        risks.append({"title": "No major weekly risk detected", "detail": "Keep logging enough data for this to stay meaningful.", "severity": "low", "action_url": "/analytics"})

    today_payload = dashboard_today_payload()
    primary = today_payload.get("primary_focus") or {}
    next_focus: list[dict] = []
    if primary:
        next_focus.append({"title": primary.get("title"), "detail": "Best next task from today's command logic.", "action_url": DAY2DAY_TASKS_URL})
    if projects_due_soon:
        next_focus.append({"title": "Review deadline-heavy projects", "detail": "Check scope, next actions, and schedule protection.", "action_url": BUILD_PROJECTS_URL})
    if contacts_due:
        next_focus.append({"title": "Clear due follow-ups", "detail": "Relationship maintenance is overdue or due today.", "action_url": "/life"})
    if len(next_focus) < 3:
        next_focus.append({"title": "Write a weekly review", "detail": "Convert this summary into a saved life review entry.", "action_url": "/life"})

    return jsonify(
        {
            "period": {
                "start": start_iso,
                "end": end_iso,
                "label": f"{start_date.strftime('%d %b')} - {end_date.strftime('%d %b')}",
            },
            "scorecard": scorecard,
            "wins": wins[:4],
            "risks": risks[:4],
            "next_focus": next_focus[:4],
            "evidence": {
                "completed_tasks": completed_task_rows,
                "habit_counts": habit_counts,
                "contacts_touched": contacts_touched,
                "finance": finance,
                "health": health,
                "diet": diet,
            },
        }
    )
