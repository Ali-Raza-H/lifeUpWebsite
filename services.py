from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date, datetime, timedelta
from email.message import EmailMessage
import json
import math
import smtplib
import sqlite3
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from flask import current_app

from database import execute_db, query_db
from utils import iso_now, parse_datetime, row_to_dict, rows_to_dicts

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

_PROFILE_DEFAULTS_READY: set[str] = set()
DEFAULT_TASK_EVENT_DURATION_MINUTES = 60
TASK_ANALYTICS_DAYS = 14


def _profile_defaults_cache_key() -> str:
    try:
        return str(current_app.config["DATABASE"])
    except RuntimeError:
        return "__default__"


def mark_profile_defaults_dirty() -> None:
    _PROFILE_DEFAULTS_READY.discard(_profile_defaults_cache_key())


def seed_profile_defaults(force: bool = False) -> None:
    cache_key = _profile_defaults_cache_key()
    if not force and cache_key in _PROFILE_DEFAULTS_READY:
        return

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
    _PROFILE_DEFAULTS_READY.add(cache_key)


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


def _task_event_duration_minutes(task: dict) -> int:
    estimated_minutes = int(task.get("estimated_minutes") or 0)
    if estimated_minutes <= 0:
        return DEFAULT_TASK_EVENT_DURATION_MINUTES
    return max(15, min(estimated_minutes, 24 * 60))


def _task_calendar_window(task: dict) -> tuple[str, str] | tuple[None, None]:
    due_dt = parse_datetime(task.get("due_date"))
    if due_dt is None:
        return None, None

    start_dt = due_dt.replace(second=0, microsecond=0)
    end_dt = start_dt + timedelta(minutes=_task_event_duration_minutes(task))
    return start_dt.isoformat(sep=" "), end_dt.isoformat(sep=" ")


def get_task_by_calendar_event_id(event_id: int) -> dict:
    return row_to_dict(query_db("SELECT * FROM tasks WHERE calendar_event_id = ?", [event_id], one=True))


def get_calendar_event_for_task(task: dict) -> dict:
    event_id = task.get("calendar_event_id")
    if not event_id:
        return {}
    return row_to_dict(query_db("SELECT * FROM calendar_events WHERE id = ?", [event_id], one=True))


def is_task_due_stale(due_date: str | None) -> bool:
    due_dt = parse_datetime(due_date)
    if due_dt is None:
        return False
    return datetime.utcnow() - due_dt.replace(tzinfo=None) >= timedelta(hours=24)


def mark_stale_tasks_not_completed() -> None:
    now = iso_now()
    execute_db(
        """
        UPDATE tasks
        SET not_completed = 1,
            not_completed_at = COALESCE(not_completed_at, ?)
        WHERE status != 'completed'
            AND due_date IS NOT NULL
            AND DATETIME(due_date) <= DATETIME(?, '-24 hours')
            AND COALESCE(not_completed, 0) = 0
        """,
        (now, now),
    )


def delete_task_with_sync(task_id: int, *, delete_linked_event: bool = True) -> bool:
    task = row_to_dict(query_db("SELECT * FROM tasks WHERE id = ?", [task_id], one=True))
    if not task:
        return False

    event_id = task.get("calendar_event_id")
    execute_db("DELETE FROM tasks WHERE id = ?", [task_id])

    if delete_linked_event and event_id:
        execute_db("DELETE FROM calendar_events WHERE id = ?", [event_id])
    return True


def delete_calendar_event_with_sync(event_id: int, *, delete_linked_task: bool = True) -> bool:
    event = query_db("SELECT id FROM calendar_events WHERE id = ?", [event_id], one=True)
    if not event:
        return False

    linked_task = get_task_by_calendar_event_id(event_id)
    if linked_task:
        if delete_linked_task:
            execute_db("DELETE FROM tasks WHERE id = ?", [linked_task["id"]])
        else:
            execute_db("UPDATE tasks SET calendar_event_id = NULL WHERE id = ?", [linked_task["id"]])

    execute_db("DELETE FROM calendar_events WHERE id = ?", [event_id])
    return True


def sync_calendar_event_for_task(task: dict) -> dict:
    if not task:
        return {}

    event_id = task.get("calendar_event_id")
    if int(task.get("calendar_sync_enabled", 1) if task.get("calendar_sync_enabled") is not None else 1) == 0:
        if event_id:
            delete_calendar_event_with_sync(int(event_id), delete_linked_task=False)
        return {}

    start_at, end_at = _task_calendar_window(task)
    if start_at is None or end_at is None:
        if event_id:
            delete_calendar_event_with_sync(int(event_id), delete_linked_task=False)
        return {}

    current_event = get_calendar_event_for_task(task)
    payload = (
        task["title"],
        task.get("description") or "",
        current_event.get("category") or "task",
        current_event.get("location") or "",
        task.get("project_id"),
        task.get("goal_id"),
        start_at,
        end_at,
    )

    if current_event:
        execute_db(
            """
            UPDATE calendar_events
            SET title = ?, description = ?, category = ?, location = ?, project_id = ?, goal_id = ?, start_at = ?, end_at = ?, recurrence = 'none', recurrence_until = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (*payload, current_event["id"]),
        )
        return row_to_dict(query_db("SELECT * FROM calendar_events WHERE id = ?", [current_event["id"]], one=True))

    new_event_id = execute_db(
        """
        INSERT INTO calendar_events (title, description, category, location, project_id, goal_id, start_at, end_at, recurrence, recurrence_until, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'none', NULL, CURRENT_TIMESTAMP)
        """,
        payload,
    )
    execute_db("UPDATE tasks SET calendar_event_id = ? WHERE id = ?", [new_event_id, task["id"]])
    return row_to_dict(query_db("SELECT * FROM calendar_events WHERE id = ?", [new_event_id], one=True))


def sync_task_for_calendar_event(event: dict, sync_task: bool) -> dict:
    if not event or not event.get("id"):
        return {}

    linked_task = get_task_by_calendar_event_id(int(event["id"]))
    if not sync_task:
        if linked_task:
            execute_db("DELETE FROM tasks WHERE id = ?", [linked_task["id"]])
        return {}

    start_dt = parse_datetime(event.get("start_at"))
    end_dt = parse_datetime(event.get("end_at"))
    if start_dt is None or end_dt is None:
        return linked_task

    estimated_minutes = max(15, int((end_dt - start_dt).total_seconds() // 60 or DEFAULT_TASK_EVENT_DURATION_MINUTES))
    due_date = start_dt.replace(second=0, microsecond=0).isoformat(sep=" ")
    description = event.get("description") or ""
    if linked_task:
        execute_db(
            """
            UPDATE tasks
            SET title = ?, description = ?, due_date = ?, estimated_minutes = ?, project_id = ?, goal_id = ?, calendar_event_id = ?, calendar_sync_enabled = 1
            WHERE id = ?
            """,
            (
                event["title"],
                description,
                due_date,
                estimated_minutes,
                event.get("project_id"),
                event.get("goal_id"),
                event["id"],
                linked_task["id"],
            ),
        )
        return row_to_dict(query_db("SELECT * FROM tasks WHERE id = ?", [linked_task["id"]], one=True))

    task_id = execute_db(
        """
        INSERT INTO tasks (title, description, priority, due_date, estimated_minutes, status, project_id, goal_id, calendar_event_id, calendar_sync_enabled)
        VALUES (?, ?, 3, ?, ?, 'pending', ?, ?, ?, 1)
        """,
        (
            event["title"],
            description,
            due_date,
            estimated_minutes,
            event.get("project_id"),
            event.get("goal_id"),
            event["id"],
        ),
    )
    return row_to_dict(query_db("SELECT * FROM tasks WHERE id = ?", [task_id], one=True))


def maybe_create_linkedin_draft_for_task(task_id: int) -> dict:
    task = row_to_dict(
        query_db(
            """
            SELECT
                t.*,
                p.name AS project_name,
                p.description AS project_description,
                p.notes AS project_notes,
                p.status AS project_status,
                p.deadline AS project_deadline,
                g.title AS goal_title
            FROM tasks t
            LEFT JOIN projects p ON p.id = t.project_id
            LEFT JOIN goals g ON g.id = t.goal_id
            WHERE t.id = ?
            """,
            [task_id],
            one=True,
        )
    )
    if not task or task.get("status") != "completed" or not int(task.get("linkedin_post_enabled") or 0):
        return {}

    existing = row_to_dict(
        query_db("SELECT * FROM linkedin_drafts WHERE source_type = 'task' AND source_id = ?", [task_id], one=True)
    )
    if existing:
        return existing

    title = f"LinkedIn draft: {task['title']}"
    context = _task_context_summary(task)
    fallback_body = _build_task_linkedin_post(task)
    draft, created = _create_linkedin_draft_record(
        "task",
        task_id,
        title,
        fallback_body,
        context,
        email_status="pending",
        email_error="",
    )
    if not created:
        return draft

    body = _generate_task_linkedin_post(task) or fallback_body
    return _finalize_linkedin_draft(draft["id"], body)


def maybe_create_linkedin_draft_for_project(project_id: int) -> dict:
    project = row_to_dict(query_db("SELECT * FROM projects WHERE id = ?", [project_id], one=True))
    if not project or project.get("status") != "completed" or not int(project.get("linkedin_post_enabled") or 0):
        return {}

    existing = row_to_dict(
        query_db("SELECT * FROM linkedin_drafts WHERE source_type = 'project' AND source_id = ?", [project_id], one=True)
    )
    if existing:
        return existing

    tasks = rows_to_dicts(
        query_db(
            """
            SELECT *
            FROM tasks
            WHERE project_id = ?
            ORDER BY
                CASE status WHEN 'completed' THEN 0 ELSE 1 END,
                completed_at DESC,
                created_at DESC,
                id DESC
            LIMIT 12
            """,
            [project_id],
        )
    )
    milestones = rows_to_dicts(
        query_db(
            """
            SELECT *
            FROM project_milestones
            WHERE project_id = ?
            ORDER BY
                CASE status WHEN 'completed' THEN 0 ELSE 1 END,
                completed_at DESC,
                created_at DESC,
                id DESC
            LIMIT 8
            """,
            [project_id],
        )
    )
    title = f"LinkedIn draft: {project['name']}"
    context = _project_context_summary(project, tasks, milestones)
    fallback_body = _build_project_linkedin_post(project, tasks, milestones)
    draft, created = _create_linkedin_draft_record(
        "project",
        project_id,
        title,
        fallback_body,
        context,
        email_status="pending",
        email_error="",
    )
    if not created:
        return draft

    body = _generate_project_linkedin_post(project, tasks, milestones) or fallback_body
    return _finalize_linkedin_draft(draft["id"], body)


def resend_linkedin_draft_email(draft_id: int) -> dict:
    draft = row_to_dict(query_db("SELECT * FROM linkedin_drafts WHERE id = ?", [draft_id], one=True))
    if not draft:
        return {}
    _attempt_send_linkedin_draft(draft)
    return row_to_dict(query_db("SELECT * FROM linkedin_drafts WHERE id = ?", [draft_id], one=True))


def generate_linkedin_draft(draft_id: int) -> dict:
    draft = row_to_dict(query_db("SELECT * FROM linkedin_drafts WHERE id = ?", [draft_id], one=True))
    if not draft:
        return {}

    prompt = _build_linkedin_generation_prompt(draft.get("context_summary", ""), draft.get("source_type", "task"))
    generated = _generate_linkedin_post_with_gemini(prompt) or draft.get("post_body", "")
    if not generated:
        return draft
    return _finalize_linkedin_draft(draft_id, generated)


def generate_journal_entry_feedback(entry_id: int) -> tuple[dict, str]:
    entry = row_to_dict(query_db("SELECT * FROM journal_entries WHERE id = ?", [entry_id], one=True))
    if not entry:
        return {}, "not_found"

    prompt = _build_journal_feedback_prompt(entry)
    model = str(current_app.config.get("JOURNAL_FEEDBACK_MODEL", "gemini-2.5-flash-lite")).strip()
    feedback = _generate_text_with_gemini(
        prompt,
        model=model or "gemini-2.5-flash-lite",
        max_output_tokens=520,
        temperature=0.2,
        top_p=0.75,
    )
    feedback = _clean_generated_text(feedback)[:2500]
    if not feedback:
        return entry, "AI feedback could not be generated. Check the Gemini API key and model configuration."

    generated_at = iso_now()
    execute_db(
        """
        UPDATE journal_entries
        SET ai_feedback = ?, ai_feedback_generated_at = ?, ai_feedback_model = ?, updated_at = ?
        WHERE id = ?
        """,
        (feedback, generated_at, model, generated_at, entry_id),
    )
    updated = row_to_dict(query_db("SELECT * FROM journal_entries WHERE id = ?", [entry_id], one=True))
    return updated, ""


def finalize_linkedin_draft_generation(draft_id: int, post_body: str) -> dict:
    draft = row_to_dict(query_db("SELECT * FROM linkedin_drafts WHERE id = ?", [draft_id], one=True))
    if not draft:
        return {}

    cleaned = _clean_generated_linkedin_post(post_body)
    if not cleaned:
        return draft
    return _finalize_linkedin_draft(draft_id, cleaned)


def _create_linkedin_draft_record(
    source_type: str,
    source_id: int,
    title: str,
    post_body: str,
    context_summary: str,
    *,
    email_status: str = "pending",
    email_error: str = "",
) -> tuple[dict, bool]:
    email_to = current_app.config.get("LINKEDIN_EMAIL_TO", "khadamalihussain@gmail.com")
    existing = row_to_dict(
        query_db(
            "SELECT * FROM linkedin_drafts WHERE source_type = ? AND source_id = ?",
            [source_type, source_id],
            one=True,
        )
    )
    if existing:
        return existing, False

    try:
        draft_id = execute_db(
            """
            INSERT INTO linkedin_drafts (
                source_type, source_id, title, post_body, context_summary, email_to, email_status, email_error, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (source_type, source_id, title, post_body, context_summary, email_to, email_status, email_error),
        )
    except sqlite3.IntegrityError:
        return (
            row_to_dict(
                query_db(
                    "SELECT * FROM linkedin_drafts WHERE source_type = ? AND source_id = ?",
                    [source_type, source_id],
                    one=True,
                )
            ),
            False,
        )

    return row_to_dict(query_db("SELECT * FROM linkedin_drafts WHERE id = ?", [draft_id], one=True)), True


def _smtp_not_enabled_message() -> str:
    return "SMTP not enabled."


def _smtp_delivery_failed_message() -> str:
    return "SMTP delivery failed."


def _finalize_linkedin_draft(draft_id: int, post_body: str) -> dict:
    execute_db(
        """
        UPDATE linkedin_drafts
        SET post_body = ?, email_status = 'pending', email_error = '', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (post_body, draft_id),
    )
    draft = row_to_dict(query_db("SELECT * FROM linkedin_drafts WHERE id = ?", [draft_id], one=True))
    _attempt_send_linkedin_draft(draft)
    return row_to_dict(query_db("SELECT * FROM linkedin_drafts WHERE id = ?", [draft_id], one=True))


def _attempt_send_linkedin_draft(draft: dict) -> None:
    host = current_app.config.get("SMTP_HOST", "")
    sender = current_app.config.get("SMTP_FROM", "")
    recipient = draft.get("email_to") or current_app.config.get("LINKEDIN_EMAIL_TO", "khadamalihussain@gmail.com")
    if not host or not sender:
        execute_db(
            """
            UPDATE linkedin_drafts
            SET email_status = 'not_configured', email_error = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (_smtp_not_enabled_message(), draft["id"]),
        )
        return

    message = EmailMessage()
    message["Subject"] = draft["title"]
    message["From"] = sender
    message["To"] = recipient
    message.set_content(
        "\n".join(
            [
                "LinkedIn post draft",
                "",
                draft.get("post_body") or "",
                "",
                "--- Context ---",
                draft.get("context_summary") or "",
            ]
        )
    )

    try:
        with smtplib.SMTP(host, int(current_app.config.get("SMTP_PORT", 587)), timeout=15) as smtp:
            if current_app.config.get("SMTP_USE_TLS", True):
                smtp.starttls()
            username = current_app.config.get("SMTP_USERNAME", "")
            password = current_app.config.get("SMTP_PASSWORD", "")
            if username:
                smtp.login(username, password)
            smtp.send_message(message)
    except smtplib.SMTPAuthenticationError:
        execute_db(
            """
            UPDATE linkedin_drafts
            SET email_status = 'not_configured', email_error = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (_smtp_not_enabled_message(), draft["id"]),
        )
        return
    except Exception as exc:
        execute_db(
            """
            UPDATE linkedin_drafts
            SET email_status = 'failed', email_error = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (_smtp_delivery_failed_message(), draft["id"]),
        )
        return

    execute_db(
        """
        UPDATE linkedin_drafts
        SET email_status = 'sent', email_error = '', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        [draft["id"]],
    )


def _task_context_summary(task: dict) -> str:
    lines = [
        f"Task: {task.get('title')}",
        f"Completed: {task.get('completed_at') or 'Unknown'}",
    ]
    if task.get("description"):
        lines.append(f"Task details: {task['description']}")
    if task.get("project_name"):
        lines.append(f"Project: {task['project_name']}")
    if task.get("project_description"):
        lines.append(f"Project context: {task['project_description']}")
    if task.get("goal_title"):
        lines.append(f"Linked goal: {task['goal_title']}")
    if task.get("estimated_minutes"):
        lines.append(f"Estimated work: {task['estimated_minutes']} minutes")
    return "\n".join(lines)


def _project_context_summary(project: dict, tasks: list[dict], milestones: list[dict]) -> str:
    completed_tasks = [task for task in tasks if task.get("status") == "completed"]
    completed_milestones = [milestone for milestone in milestones if milestone.get("status") == "completed"]
    lines = [
        f"Project: {project.get('name')}",
        f"Completed: {project.get('completed_at') or 'Unknown'}",
    ]
    if project.get("description"):
        lines.append(f"Description: {project['description']}")
    if project.get("notes"):
        lines.append(f"Notes: {project['notes']}")
    if completed_tasks:
        lines.append("Completed tasks: " + "; ".join(task["title"] for task in completed_tasks[:6]))
    if completed_milestones:
        lines.append("Completed stages: " + "; ".join(item["title"] for item in completed_milestones[:5]))
    return "\n".join(lines)


def _generate_task_linkedin_post(task: dict) -> str:
    prompt = _build_linkedin_generation_prompt(_task_context_summary(task), "task")
    generated = _generate_linkedin_post_with_gemini(prompt)
    return generated or _build_task_linkedin_post(task)


def _generate_project_linkedin_post(project: dict, tasks: list[dict], milestones: list[dict]) -> str:
    prompt = _build_linkedin_generation_prompt(_project_context_summary(project, tasks, milestones), "project")
    generated = _generate_linkedin_post_with_gemini(prompt)
    return generated or _build_project_linkedin_post(project, tasks, milestones)


def _build_linkedin_generation_prompt(context: str, source_type: str) -> str:
    is_project = source_type == "project"
    angle = "announcing a completed project" if is_project else "sharing a completed task inside an active project"
    word_limit = 200 if is_project else 180
    return (
        f"Write a LinkedIn post for a student/developer {angle}.\n"
        "Use the context below. Make it specific, credible, and useful for building visibility.\n"
        "Mention what was built or completed, why it matters, and what skill signal it gives.\n"
        "Avoid inventing facts, fake metrics, cringe hype, and buzzword spam.\n"
        f"Keep it under {word_limit} words and end with 2-4 relevant hashtags.\n\n"
        f"Context:\n{context}\n\n"
        "Return only the post text."
    )


def _build_journal_feedback_prompt(entry: dict) -> str:
    return (
        "You are reviewing a private journal entry. Give objective feedback, not encouragement.\n"
        "Use only evidence from the entry. Do not flatter, reassure, diagnose, moralize, or make the writer feel good.\n"
        "Point out patterns, weak assumptions, missing evidence, contradictions, and one practical next step.\n"
        "If the entry lacks enough detail, say exactly what information is missing.\n"
        "Keep the response under 170 words. Use this exact format:\n"
        "Main pattern: ...\n"
        "Possible blind spot: ...\n"
        "Contradiction or tension: ...\n"
        "Next step: ...\n"
        "Question to answer: ...\n\n"
        f"Title: {entry.get('title') or 'Untitled'}\n"
        f"Mood score: {entry.get('mood_score')}/10\n"
        f"Tags: {entry.get('tags') or 'None'}\n"
        f"Entry:\n{entry.get('content') or ''}\n"
    )


def _generate_linkedin_post_with_gemini(prompt: str) -> str:
    model = str(current_app.config.get("GEMINI_MODEL", "gemini-2.5-flash-lite")).strip()
    text = _generate_text_with_gemini(
        prompt,
        model=model or "gemini-2.5-flash-lite",
        max_output_tokens=420,
        temperature=0.72,
        top_p=0.9,
    )
    return _clean_generated_linkedin_post(text)


def _generate_text_with_gemini(
    prompt: str,
    *,
    model: str,
    max_output_tokens: int,
    temperature: float,
    top_p: float,
) -> str:
    if current_app.config.get("TESTING") or not current_app.config.get("GEMINI_ENABLED", True):
        return ""

    api_key = str(current_app.config.get("GEMINI_API_KEY", "")).strip()
    if not api_key:
        return ""

    timeout = float(current_app.config.get("GEMINI_TIMEOUT_SECONDS", 45))
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": prompt,
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": temperature,
            "topP": top_p,
            "maxOutputTokens": max_output_tokens,
        },
    }
    request = Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe='')}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        details = ""
        try:
            details = exc.read().decode("utf-8")[:500]
        except OSError:
            details = ""
        current_app.logger.warning("Gemini request failed with HTTP %s: %s", exc.code, details)
        return ""
    except (URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        current_app.logger.warning("Gemini request failed: %s", exc)
        return ""

    return _extract_gemini_text(data)


def _clean_generated_text(text: str) -> str:
    cleaned = str(text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
    for prefix in ("Feedback:", "Objective feedback:", "AI feedback:"):
        if cleaned.lower().startswith(prefix.lower()):
            cleaned = cleaned[len(prefix):].strip()
    return cleaned


def _extract_gemini_text(data: dict) -> str:
    candidates = data.get("candidates")
    if not isinstance(candidates, list):
        return ""
    for candidate in candidates:
        content = candidate.get("content") if isinstance(candidate, dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            continue
        text_chunks = []
        for part in parts:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                text_chunks.append(part["text"])
        text = "\n".join(chunk.strip() for chunk in text_chunks if chunk and chunk.strip()).strip()
        if text:
            return text
    return ""


def _clean_generated_linkedin_post(text: str) -> str:
    if not text:
        return ""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
    for prefix in ("LinkedIn post:", "Post:", "Draft:"):
        if cleaned.lower().startswith(prefix.lower()):
            cleaned = cleaned[len(prefix):].strip()
    return cleaned[:2500]


def _build_task_linkedin_post(task: dict) -> str:
    project_line = f" as part of {task['project_name']}" if task.get("project_name") else ""
    goal_line = f"\n\nThis connects to my broader goal: {task['goal_title']}." if task.get("goal_title") else ""
    description = task.get("description") or "This was a focused build task with a clear outcome."
    project_context = ""
    if task.get("project_description"):
        project_context = f"\n\nProject context: {task['project_description']}"

    return (
        f"I just completed: {task['title']}{project_line}.\n\n"
        f"What I worked on:\n{description}"
        f"{project_context}"
        f"{goal_line}\n\n"
        "The main value was turning an idea into something concrete, testable, and easier to build on. "
        "I am trying to document more of the practical work behind each project, not just the finished result.\n\n"
        "#buildinpublic #softwaredevelopment #learning"
    )


def _build_project_linkedin_post(project: dict, tasks: list[dict], milestones: list[dict]) -> str:
    completed_tasks = [task["title"] for task in tasks if task.get("status") == "completed"][:5]
    completed_milestones = [item["title"] for item in milestones if item.get("status") == "completed"][:4]
    task_block = "\n".join(f"- {title}" for title in completed_tasks) or "- Planned, built, and completed the core work."
    milestone_block = "\n".join(f"- {title}" for title in completed_milestones)
    milestone_section = f"\n\nKey stages completed:\n{milestone_block}" if milestone_block else ""
    description = project.get("description") or "This project helped me practise turning requirements into a working system."

    return (
        f"I just completed a project: {project['name']}.\n\n"
        f"What it was about:\n{description}\n\n"
        f"Some of the work involved:\n{task_block}"
        f"{milestone_section}\n\n"
        "The useful part was not only finishing it, but capturing the process: planning the work, breaking it into tasks, "
        "and shipping something that can be improved further.\n\n"
        "#buildinpublic #projects #softwaredevelopment"
    )


def get_traits_payload() -> list[dict]:
    seed_profile_defaults()
    return _get_traits_payload()


def _get_traits_payload() -> list[dict]:
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
    return _get_beliefs_payload()


def _get_beliefs_payload() -> list[dict]:
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


def _month_full_target_periods(
    frequency: str,
    month_start: date,
    month_end: date,
    created_at: str | None,
    earliest_log_date: date | None = None,
) -> int:
    created_date = _coerce_date(created_at) or month_start
    if earliest_log_date and earliest_log_date < created_date:
        created_date = earliest_log_date

    track_start = max(created_date, month_start)
    if month_end < track_start:
        return 0

    active_days = (month_end - track_start).days + 1
    if frequency == "weekly":
        return max(1, math.ceil(active_days / 7))
    if frequency == "monthly":
        return 1
    return active_days


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
        full_target_days = _month_full_target_periods(
            habit["frequency"],
            month_start,
            month_end,
            habit.get("created_at"),
            earliest_log_date,
        )
        completed_days = sum(
            1
            for current_date, status in log_map.items()
            if status == "completed" and month_start.isoformat() <= current_date <= month_end.isoformat()
        )
        completion_rate = round((completed_days / target_days) * 100) if target_days else 0
        full_completion_rate = round((completed_days / full_target_days) * 100) if full_target_days else 0

        enriched = {
            **habit,
            "current_streak": calculate_streak(habit["frequency"], completed_dates),
            "month_completed_days": completed_days,
            "month_target_days": target_days,
            "month_completion_rate": min(100, completion_rate),
            "month_full_target_days": full_target_days,
            "month_full_completion_rate": min(100, full_completion_rate),
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
    return _get_skills_payload()


def _get_skills_payload() -> list[dict]:
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


def get_profile_payload() -> dict[str, list[dict]]:
    seed_profile_defaults()
    return {
        "traits": _get_traits_payload(),
        "beliefs": _get_beliefs_payload(),
        "skills": _get_skills_payload(),
    }


def reset_profile_defaults() -> dict[str, int]:
    mark_profile_defaults_dirty()
    execute_db("DELETE FROM skills")
    execute_db("DELETE FROM beliefs")
    execute_db("DELETE FROM traits")
    seed_profile_defaults(force=True)
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
            g.title AS goal_title,
            t.id AS linked_task_id,
            t.status AS linked_task_status
        FROM calendar_events ce
        LEFT JOIN projects p ON p.id = ce.project_id
        LEFT JOIN goals g ON g.id = ce.goal_id
        LEFT JOIN tasks t ON t.calendar_event_id = ce.id
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
    next_action_rows = rows_to_dicts(
        query_db(
            """
            SELECT
                project_id,
                action_type,
                action_id,
                title,
                status,
                due_date,
                sort_group,
                priority_rank
            FROM (
                SELECT
                    project_id,
                    'task' AS action_type,
                    id AS action_id,
                    title,
                    status,
                    due_date,
                    CASE status
                        WHEN 'in_progress' THEN 0
                        WHEN 'pending' THEN 1
                        ELSE 2
                    END AS sort_group,
                    priority AS priority_rank
                FROM tasks
                WHERE project_id IS NOT NULL AND status != 'completed'

                UNION ALL

                SELECT
                    project_id,
                    'milestone' AS action_type,
                    id AS action_id,
                    title,
                    status,
                    due_date,
                    CASE status
                        WHEN 'in_progress' THEN 0
                        WHEN 'pending' THEN 1
                        ELSE 2
                    END AS sort_group,
                    5 AS priority_rank
                FROM project_milestones
                WHERE project_id IS NOT NULL AND status != 'completed'
            )
            ORDER BY
                project_id ASC,
                sort_group ASC,
                COALESCE(due_date, '9999-12-31') ASC,
                priority_rank ASC,
                action_id ASC
            """
        )
    )
    resource_rows = rows_to_dicts(
        query_db(
            """
            SELECT entity_id AS project_id, COUNT(*) AS resource_count
            FROM attachments
            WHERE entity_type = 'project' AND entity_id IS NOT NULL
            GROUP BY entity_id
            """
        )
    )
    milestone_map = {row["project_id"]: row for row in milestone_rows}
    resource_map = {row["project_id"]: int(row["resource_count"] or 0) for row in resource_rows}
    next_action_map: dict[int, dict] = {}
    for row in next_action_rows:
        project_id = row.get("project_id")
        if project_id is None or project_id in next_action_map:
            continue
        next_action_map[project_id] = {
            "kind": row["action_type"],
            "id": row["action_id"],
            "title": row["title"],
            "status": row["status"],
            "due_date": row["due_date"],
        }

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
        project["resource_count"] = resource_map.get(project["id"], 0)
        project["next_action"] = next_action_map.get(project["id"])
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


def task_analytics_series(days: int = TASK_ANALYTICS_DAYS) -> dict[str, list]:
    safe_days = max(1, days)
    today = date.today()
    start_date = today - timedelta(days=safe_days - 1)
    total_tasks = int(query_db("SELECT COUNT(*) AS count FROM tasks", one=True)["count"] or 0)

    completed_rows = rows_to_dicts(
        query_db(
            """
            SELECT DATE(completed_at) AS event_date, COUNT(*) AS count
            FROM tasks
            WHERE completed_at IS NOT NULL AND DATE(completed_at) >= ?
            GROUP BY DATE(completed_at)
            """,
            [start_date.isoformat()],
        )
    )
    completed_map = {row["event_date"]: int(row["count"] or 0) for row in completed_rows}

    labels: list[str] = []
    completed_values: list[int] = []
    share_values: list[int] = []
    for offset in range(safe_days):
        current = start_date + timedelta(days=offset)
        key = current.isoformat()
        completed_count = completed_map.get(key, 0)
        labels.append(current.strftime("%d %b"))
        completed_values.append(completed_count)
        share_values.append(round((completed_count / total_tasks) * 100) if total_tasks else 0)

    return {
        "labels": labels,
        "completed": completed_values,
        "share_of_total": share_values,
        "total_tasks": total_tasks,
    }


def _consistency_rate_from_calendar_habits(habits: list[dict]) -> int:
    if not habits:
        return 0

    total_completed = sum(min(habit["month_completed_days"], habit["month_target_days"]) for habit in habits)
    total_target = sum(habit["month_target_days"] for habit in habits)
    if total_target == 0:
        return 0
    return round((total_completed / total_target) * 100)


def consistency_rate() -> int:
    return _consistency_rate_from_calendar_habits(build_habit_calendar_payload()["habits"])


def habits_monthly_report(calendar_habits: list[dict] | None = None) -> list[dict]:
    habits = calendar_habits if calendar_habits is not None else build_habit_calendar_payload()["habits"]
    return [
        {
            "id": habit["id"],
            "name": habit["name"],
            "completed_days": habit["month_completed_days"],
            "target_days": habit["month_target_days"],
            "completion_rate": habit["month_completion_rate"],
            "full_target_days": habit["month_full_target_days"],
            "full_completion_rate": habit["month_full_completion_rate"],
        }
        for habit in habits
    ]


def dashboard_overview_payload(calendar_habits: list[dict] | None = None) -> dict:
    total_tasks = query_db("SELECT COUNT(*) AS count FROM tasks", one=True)["count"]
    completed_tasks = query_db("SELECT COUNT(*) AS count FROM tasks WHERE status = 'completed'", one=True)["count"]
    active_habits = query_db("SELECT COUNT(*) AS count FROM habits", one=True)["count"]
    active_projects = query_db(
        "SELECT COUNT(*) AS count FROM projects WHERE status NOT IN ('completed', 'archived')",
        one=True,
    )["count"]
    active_goals = query_db(
        "SELECT COUNT(*) AS count FROM goals WHERE status NOT IN ('completed', 'archived')",
        one=True,
    )["count"]

    consistency = (
        _consistency_rate_from_calendar_habits(calendar_habits)
        if calendar_habits is not None
        else consistency_rate()
    )

    return {
        "total_tasks": int(total_tasks or 0),
        "completed_tasks": int(completed_tasks or 0),
        "task_completion_rate": round((int(completed_tasks or 0) / int(total_tasks or 0)) * 100) if total_tasks else 0,
        "active_habits": int(active_habits or 0),
        "active_projects": int(active_projects or 0),
        "active_goals": int(active_goals or 0),
        "consistency": consistency,
        "system_status": "Nominal",
    }


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


def dashboard_active_tasks_payload() -> list[dict]:
    return rows_to_dicts(
        query_db(
            """
            SELECT *
            FROM tasks
            WHERE status IN ('pending', 'in_progress', 'on_hold')
            ORDER BY
                CASE status
                    WHEN 'pending' THEN 0
                    WHEN 'in_progress' THEN 1
                    ELSE 2
                END,
                priority ASC,
                COALESCE(due_date, '9999-12-31') ASC,
                created_at DESC,
                id DESC
            """
        )
    )


def dashboard_payload() -> dict:
    calendar_habits = build_habit_calendar_payload()["habits"]
    return {
        "tasks": dashboard_active_tasks_payload(),
        "projects": fetch_project_metrics(),
        "habits": serialize_habits_with_metrics(),
        "overview": dashboard_overview_payload(calendar_habits),
        "habits_monthly": habits_monthly_report(calendar_habits),
        "task_velocity": weekly_completion_series(),
        "task_analytics": task_analytics_series(),
        "today": dashboard_today_payload(),
    }


def dashboard_today_payload() -> dict:
    today = date.today().isoformat()
    now = datetime.now().replace(second=0, microsecond=0)
    now_iso = now.isoformat(sep=" ")
    tomorrow_iso = (now.date() + timedelta(days=1)).isoformat()

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
    follow_ups_due = int(
        query_db(
            """
            SELECT COUNT(*) AS count
            FROM contacts
            WHERE next_follow_up IS NOT NULL
              AND next_follow_up <= ?
            """,
            [today],
            one=True,
        )["count"]
        or 0
    )

    open_habit_rows = rows_to_dicts(
        query_db(
            """
            SELECT h.name
            FROM habits h
            LEFT JOIN habit_logs hl
              ON hl.habit_id = h.id
             AND hl.log_date = ?
             AND hl.status = 'completed'
            WHERE hl.id IS NULL
            ORDER BY h.name COLLATE NOCASE ASC
            LIMIT 3
            """,
            [today],
        )
    )
    open_habit_names = [row["name"] for row in open_habit_rows]

    current_event_row = query_db(
        """
        SELECT
            ce.*,
            p.name AS project_name,
            g.title AS goal_title
        FROM calendar_events ce
        LEFT JOIN projects p ON p.id = ce.project_id
        LEFT JOIN goals g ON g.id = ce.goal_id
        WHERE ce.start_at <= ?
          AND ce.end_at > ?
        ORDER BY ce.end_at ASC
        LIMIT 1
        """,
        [now_iso, now_iso],
        one=True,
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
        WHERE ce.start_at > ?
        ORDER BY ce.start_at ASC
        LIMIT 1
        """,
        [now_iso],
        one=True,
    )

    focus_tasks = rows_to_dicts(
        query_db(
            """
            SELECT
                t.*,
                p.name AS project_name,
                g.title AS goal_title
            FROM tasks t
            LEFT JOIN projects p ON p.id = t.project_id
            LEFT JOIN goals g ON g.id = t.goal_id
            WHERE t.status IN ('pending', 'in_progress', 'on_hold')
            ORDER BY
                CASE WHEN DATE(t.due_date) = ? THEN 0 WHEN t.due_date IS NULL THEN 2 ELSE 1 END,
                t.priority ASC,
                COALESCE(t.due_date, '9999-12-31') ASC,
                t.created_at DESC
            LIMIT 4
            """,
            [today],
        )
    )

    def _serialize_focus_task(task: dict) -> dict:
        due_dt = parse_datetime(task.get("due_date"))
        reason = "backlog"
        if due_dt and due_dt.date().isoformat() < today:
            reason = "overdue"
        elif due_dt and due_dt.date().isoformat() == today:
            reason = "due_today"
        elif task.get("status") == "in_progress":
            reason = "in_progress"
        elif int(task.get("priority") or 3) <= 2:
            reason = "high_priority"

        return {
            **task,
            "focus_reason": reason,
        }

    focus_tasks = [_serialize_focus_task(task) for task in focus_tasks]
    primary_focus = focus_tasks[0] if focus_tasks else {}

    def _event_task_context(event: dict) -> tuple[int, list[dict]]:
        if not event:
            return 0, []
        filters: list[str] = ["t.status != 'completed'"]
        params: list[object] = []
        relation_filters: list[str] = []

        if event.get("id"):
            relation_filters.append("t.calendar_event_id = ?")
            params.append(event["id"])
        if event.get("project_id"):
            relation_filters.append("t.project_id = ?")
            params.append(event["project_id"])
        if event.get("goal_id"):
            relation_filters.append("t.goal_id = ?")
            params.append(event["goal_id"])

        if not relation_filters:
            return 0, []

        filters.append(f"({' OR '.join(relation_filters)})")
        where_clause = " AND ".join(filters)
        count = int(
            query_db(
                f"SELECT COUNT(DISTINCT t.id) AS count FROM tasks t WHERE {where_clause}",
                params,
                one=True,
            )["count"]
            or 0
        )
        rows = rows_to_dicts(
            query_db(
                f"""
                SELECT DISTINCT
                    t.id,
                    t.title,
                    t.priority,
                    t.status,
                    t.due_date,
                    t.estimated_minutes
                FROM tasks t
                WHERE {where_clause}
                ORDER BY t.priority ASC, COALESCE(t.due_date, '9999-12-31') ASC, t.created_at DESC
                LIMIT 3
                """,
                params,
            )
        )
        return count, rows

    def _serialize_event(event_row, *, following_after: str | None = None) -> dict:
        event = row_to_dict(event_row)
        if not event:
            return {}

        start_dt = parse_datetime(event.get("start_at"))
        end_dt = parse_datetime(event.get("end_at"))
        duration_minutes = 0
        minutes_until_start = None
        minutes_until_end = None
        status = "upcoming"
        if start_dt and end_dt:
            duration_minutes = max(0, int((end_dt - start_dt).total_seconds() // 60))
            minutes_until_start = int((start_dt - now).total_seconds() // 60)
            minutes_until_end = int((end_dt - now).total_seconds() // 60)
            if start_dt <= now < end_dt:
                status = "ongoing"

        related_count, related_tasks = _event_task_context(event)

        following_event_row = None
        if following_after:
            following_event_row = query_db(
                """
                SELECT title, start_at, category, location
                FROM calendar_events
                WHERE start_at > ?
                ORDER BY start_at ASC
                LIMIT 1
                """,
                [following_after],
                one=True,
            )
        following_event = row_to_dict(following_event_row)
        following_start = parse_datetime(following_event.get("start_at")) if following_event else None
        buffer_after_minutes = (
            int((following_start - end_dt).total_seconds() // 60)
            if following_start and end_dt
            else None
        )

        return {
            **event,
            "status": status,
            "duration_minutes": duration_minutes,
            "minutes_until_start": minutes_until_start,
            "minutes_until_end": minutes_until_end,
            "related_open_task_count": related_count,
            "related_open_tasks": related_tasks,
            "following_event": following_event,
            "buffer_after_minutes": buffer_after_minutes,
        }

    current_event = _serialize_event(current_event_row, following_after=row_to_dict(current_event_row).get("end_at") if current_event_row else None)
    next_event = _serialize_event(next_event_row, following_after=row_to_dict(next_event_row).get("end_at") if next_event_row else None)

    remaining_events_today = int(
        query_db(
            """
            SELECT COUNT(*) AS count
            FROM calendar_events
            WHERE end_at >= ?
              AND start_at < ?
            """,
            [now_iso, f"{tomorrow_iso} 00:00:00"],
            one=True,
        )["count"]
        or 0
    )

    next_event_start = parse_datetime(next_event.get("start_at")) if next_event else None
    free_window_minutes = (
        max(0, int((next_event_start - now).total_seconds() // 60))
        if next_event_start and not current_event
        else 0
    )

    return {
        "due_today": due_today,
        "overdue_tasks": overdue_tasks,
        "open_habits": open_habit_count,
        "open_habit_names": open_habit_names,
        "follow_ups_due": follow_ups_due,
        "current_event": current_event,
        "next_event": next_event,
        "remaining_events_today": remaining_events_today,
        "free_window_minutes": free_window_minutes,
        "focus_tasks": focus_tasks,
        "primary_focus": primary_focus,
    }


def build_notifications_payload(limit: int = 12) -> dict:
    now = datetime.now().replace(second=0, microsecond=0)
    today = now.date()
    task_rows = rows_to_dicts(
        query_db(
            """
            SELECT
                t.id,
                t.title,
                t.due_date,
                t.status,
                p.name AS project_name
            FROM tasks t
            LEFT JOIN projects p ON p.id = t.project_id
            WHERE t.status != 'completed' AND t.due_date IS NOT NULL
            ORDER BY t.due_date ASC, t.priority ASC, t.id ASC
            """
        )
    )
    event_rows = rows_to_dicts(
        query_db(
            """
            SELECT
                ce.id,
                ce.title,
                ce.start_at,
                ce.end_at,
                ce.category,
                ce.location,
                p.name AS project_name,
                t.id AS linked_task_id
            FROM calendar_events ce
            LEFT JOIN projects p ON p.id = ce.project_id
            LEFT JOIN tasks t ON t.calendar_event_id = ce.id
            WHERE ce.start_at IS NOT NULL
            ORDER BY ce.start_at ASC, ce.id ASC
            """
        )
    )
    contact_rows = rows_to_dicts(
        query_db(
            """
            SELECT id, name, next_follow_up, priority
            FROM contacts
            WHERE next_follow_up IS NOT NULL
            ORDER BY next_follow_up ASC, id ASC
            """
        )
    )

    items: list[dict] = []
    for task in task_rows:
        due_dt = parse_datetime(task.get("due_date"))
        if due_dt is None:
            continue
        if due_dt < now:
            items.append(
                {
                    "id": f"task-overdue-{task['id']}",
                    "kind": "task",
                    "severity": "high",
                    "title": f"Overdue task: {task['title']}",
                    "message": task.get("project_name") or "Task deadline has passed.",
                    "when": due_dt.isoformat(sep=" "),
                    "source_type": "task",
                    "source_id": task["id"],
                    "action_url": "/tasks",
                }
            )
        elif due_dt.date() == today:
            items.append(
                {
                    "id": f"task-today-{task['id']}",
                    "kind": "task",
                    "severity": "medium",
                    "title": f"Due today: {task['title']}",
                    "message": task.get("project_name") or "Task due later today.",
                    "when": due_dt.isoformat(sep=" "),
                    "source_type": "task",
                    "source_id": task["id"],
                    "action_url": "/tasks",
                }
            )

    upcoming_boundary = now + timedelta(hours=2)
    for event in event_rows:
        start_dt = parse_datetime(event.get("start_at"))
        if start_dt is None or start_dt < now or start_dt > upcoming_boundary:
            continue

        title_prefix = "Scheduled task" if event.get("linked_task_id") else "Upcoming event"
        items.append(
            {
                "id": f"event-upcoming-{event['id']}",
                "kind": "event",
                "severity": "medium",
                "title": f"{title_prefix}: {event['title']}",
                "message": event.get("project_name") or event.get("location") or event.get("category") or "Starts soon.",
                "when": start_dt.isoformat(sep=" "),
                "source_type": "calendar_event",
                "source_id": event["id"],
                "action_url": "/calendar",
            }
        )

    for contact in contact_rows:
        follow_up = _coerce_date(contact.get("next_follow_up"))
        if follow_up is None or follow_up > today:
            continue

        severity = "high" if contact.get("priority") == "high" or follow_up < today else "medium"
        items.append(
            {
                "id": f"contact-follow-up-{contact['id']}",
                "kind": "contact",
                "severity": severity,
                "title": f"Follow up with {contact['name']}",
                "message": f"Follow-up date: {follow_up.isoformat()}",
                "when": f"{follow_up.isoformat()} 00:00:00",
                "source_type": "contact",
                "source_id": contact["id"],
                "action_url": "/life",
            }
        )

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    items.sort(
        key=lambda item: (
            severity_rank.get(item["severity"], 3),
            item.get("when") or "9999-12-31 23:59:59",
            item["id"],
        )
    )
    limited_items = items[:limit]
    return {
        "generated_at": now.isoformat(sep=" "),
        "count": len(limited_items),
        "high_priority_count": sum(1 for item in limited_items if item["severity"] == "high"),
        "items": limited_items,
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
