from __future__ import annotations

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from services import (
    delete_task_with_sync,
    is_task_due_stale,
    mark_stale_tasks_not_completed,
    maybe_create_linkedin_draft_for_task,
    sync_calendar_event_for_task,
)
from utils import (
    ValidationError,
    get_optional_bool,
    get_optional_choice,
    get_optional_datetime,
    get_optional_int,
    get_optional_string,
    get_required_string,
    iso_now,
    require_object,
    row_to_dict,
    rows_to_dicts,
    validate_optional_reference,
)

bp = Blueprint("tasks_api", __name__, url_prefix="/api/tasks")

TASK_STATUSES = {"pending", "in_progress", "on_hold", "completed"}


@bp.route("/", methods=["GET"])
def get_tasks():
    mark_stale_tasks_not_completed()

    filters = []
    params: list = []

    status = request.args.get("status")
    if status:
        if status not in TASK_STATUSES:
            raise ValidationError("Invalid task status.", "status")
        filters.append("status = ?")
        params.append(status)

    project_id = request.args.get("project_id", type=int)
    if project_id is not None:
        filters.append("project_id = ?")
        params.append(project_id)

    goal_id = request.args.get("goal_id", type=int)
    if goal_id is not None:
        filters.append("goal_id = ?")
        params.append(goal_id)

    due_window = request.args.get("due_window")
    if due_window == "today":
        filters.append("due_date IS NOT NULL AND DATE(due_date) = DATE('now')")
    elif due_window == "overdue":
        filters.append("due_date IS NOT NULL AND DATE(due_date) < DATE('now') AND status != 'completed'")
    elif due_window == "upcoming":
        filters.append("due_date IS NOT NULL AND DATE(due_date) BETWEEN DATE('now') AND DATE('now', '+7 day')")

    query_text = request.args.get("q", "").strip()
    if query_text:
        filters.append("LOWER(title || ' ' || COALESCE(description, '')) LIKE ?")
        params.append(f"%{query_text.lower()}%")

    query = """
        SELECT *
        FROM tasks
    """
    if filters:
        query += f" WHERE {' AND '.join(filters)}"

    sort = request.args.get("sort", "default")
    if sort == "due":
        query += " ORDER BY COALESCE(due_date, '9999-12-31') ASC, priority ASC, created_at DESC, id DESC"
    elif sort == "priority":
        query += " ORDER BY priority ASC, COALESCE(due_date, '9999-12-31') ASC, created_at DESC, id DESC"
    elif sort == "recent":
        query += " ORDER BY created_at DESC, id DESC"
    else:
        query += """
            ORDER BY
                CASE status
                    WHEN 'pending' THEN 0
                    WHEN 'in_progress' THEN 1
                    WHEN 'on_hold' THEN 2
                    ELSE 4
                END,
                priority ASC,
                COALESCE(due_date, '9999-12-31') ASC,
                created_at DESC,
                id DESC
        """

    limit = request.args.get("limit", type=int)
    if limit:
        query += " LIMIT ?"
        params.append(max(1, min(limit, 100)))

    return jsonify(rows_to_dicts(query_db(query, params)))


@bp.route("/", methods=["POST"])
def create_task():
    payload = require_object(request.get_json(silent=True))
    title = get_required_string(payload, "title", max_length=140)
    description = get_optional_string(payload, "description", max_length=2000, default="") or ""
    priority = get_optional_int(payload, "priority", default=3, minimum=1, maximum=4) or 3
    due_date = get_optional_datetime(payload, "due_date")
    estimated_minutes = get_optional_int(payload, "estimated_minutes", minimum=1)
    status = get_optional_choice(payload, "status", allowed=TASK_STATUSES, default="pending") or "pending"
    project_id = get_optional_int(payload, "project_id", minimum=1)
    goal_id = get_optional_int(payload, "goal_id", minimum=1)
    validate_optional_reference(project_id, "projects", field="project_id", label="Project")
    validate_optional_reference(goal_id, "goals", field="goal_id", label="Goal")
    linkedin_post_enabled = 1 if get_optional_bool(payload, "linkedin_post_enabled", default=False) else 0
    calendar_sync_enabled = 1 if get_optional_bool(payload, "calendar_sync_enabled", default=True) else 0
    not_completed = 1 if get_optional_bool(payload, "not_completed", default=False) else 0
    if status == "completed":
        not_completed = 0
    completed_at = iso_now() if status == "completed" else None
    not_completed_at = iso_now() if not_completed else None

    task_id = execute_db(
        """
        INSERT INTO tasks (
            title, description, priority, due_date, estimated_minutes, status, project_id, goal_id,
            linkedin_post_enabled, calendar_sync_enabled, not_completed, not_completed_at, completed_at, calendar_event_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        """,
        (
            title,
            description,
            priority,
            due_date,
            estimated_minutes,
            status,
            project_id,
            goal_id,
            linkedin_post_enabled,
            calendar_sync_enabled,
            not_completed,
            not_completed_at,
            completed_at,
        ),
    )
    task = query_db("SELECT * FROM tasks WHERE id = ?", [task_id], one=True)
    sync_calendar_event_for_task(row_to_dict(task))
    task = query_db("SELECT * FROM tasks WHERE id = ?", [task_id], one=True)
    if status == "completed" and linkedin_post_enabled:
        maybe_create_linkedin_draft_for_task(task_id)
    return jsonify({"task": row_to_dict(task), "message": "Task created."}), 201


@bp.route("/<int:task_id>", methods=["PUT"])
def update_task(task_id: int):
    task = query_db("SELECT * FROM tasks WHERE id = ?", [task_id], one=True)
    if not task:
        return jsonify({"error": "Task not found."}), 404

    payload = require_object(request.get_json(silent=True))
    current_task = row_to_dict(task)

    title = get_optional_string(payload, "title", max_length=140, default=current_task["title"]) or current_task["title"]
    description = (
        get_optional_string(payload, "description", max_length=2000, default=current_task["description"])
        if "description" in payload
        else current_task["description"]
    )
    priority = get_optional_int(payload, "priority", default=current_task["priority"], minimum=1, maximum=4)
    status = get_optional_choice(payload, "status", allowed=TASK_STATUSES, default=current_task["status"]) or current_task["status"]
    due_date = get_optional_datetime(payload, "due_date") if "due_date" in payload else current_task["due_date"]
    estimated_minutes = (
        get_optional_int(payload, "estimated_minutes", minimum=1)
        if "estimated_minutes" in payload
        else current_task.get("estimated_minutes")
    )
    project_id = (
        get_optional_int(payload, "project_id", minimum=1)
        if "project_id" in payload
        else current_task["project_id"]
    )
    goal_id = (
        get_optional_int(payload, "goal_id", minimum=1)
        if "goal_id" in payload
        else current_task["goal_id"]
    )
    validate_optional_reference(project_id, "projects", field="project_id", label="Project")
    validate_optional_reference(goal_id, "goals", field="goal_id", label="Goal")
    linkedin_post_enabled = (
        1 if get_optional_bool(payload, "linkedin_post_enabled", default=bool(current_task.get("linkedin_post_enabled"))) else 0
    )
    calendar_sync_enabled = (
        1
        if get_optional_bool(
            payload,
            "calendar_sync_enabled",
            default=bool(current_task.get("calendar_sync_enabled", 1)),
        )
        else 0
    )

    current_not_completed = bool(current_task.get("not_completed"))
    not_completed = (
        bool(get_optional_bool(payload, "not_completed", default=current_not_completed))
        if "not_completed" in payload
        else current_not_completed
    )
    if "not_completed" not in payload and "due_date" in payload and not is_task_due_stale(due_date):
        not_completed = False

    completed_at = current_task.get("completed_at")
    if status == "completed" and current_task["status"] != "completed":
        completed_at = iso_now()
    elif status != "completed":
        completed_at = None
    if status == "completed":
        not_completed = False

    not_completed_at = current_task.get("not_completed_at")
    if not_completed and not current_not_completed:
        not_completed_at = iso_now()
    elif not not_completed:
        not_completed_at = None

    execute_db(
        """
        UPDATE tasks
        SET title = ?, description = ?, priority = ?, status = ?, due_date = ?, estimated_minutes = ?, project_id = ?, goal_id = ?, linkedin_post_enabled = ?, calendar_sync_enabled = ?, not_completed = ?, not_completed_at = ?, completed_at = ?
        WHERE id = ?
        """,
        (
            title,
            description,
            priority,
            status,
            due_date,
            estimated_minutes,
            project_id,
            goal_id,
            linkedin_post_enabled,
            calendar_sync_enabled,
            1 if not_completed else 0,
            not_completed_at,
            completed_at,
            task_id,
        ),
    )
    updated_task = query_db("SELECT * FROM tasks WHERE id = ?", [task_id], one=True)
    sync_calendar_event_for_task(row_to_dict(updated_task))
    updated_task = query_db("SELECT * FROM tasks WHERE id = ?", [task_id], one=True)
    if status == "completed" and linkedin_post_enabled:
        maybe_create_linkedin_draft_for_task(task_id)
    return jsonify({"task": row_to_dict(updated_task), "message": "Task updated."})


@bp.route("/<int:task_id>", methods=["DELETE"])
def delete_task(task_id: int):
    task = query_db("SELECT id FROM tasks WHERE id = ?", [task_id], one=True)
    if not task:
        return jsonify({"error": "Task not found."}), 404

    delete_task_with_sync(task_id)
    return jsonify({"message": "Task deleted."})
