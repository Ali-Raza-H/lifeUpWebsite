from __future__ import annotations

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from utils import (
    ValidationError,
    get_optional_choice,
    get_optional_date,
    get_optional_int,
    get_optional_string,
    get_required_string,
    iso_now,
    require_object,
    row_to_dict,
    rows_to_dicts,
)

bp = Blueprint("tasks_api", __name__, url_prefix="/api/tasks")

TASK_STATUSES = {"pending", "in_progress", "on_hold", "completed"}


@bp.route("/", methods=["GET"])
def get_tasks():
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

    query = """
        SELECT *
        FROM tasks
    """
    if filters:
        query += f" WHERE {' AND '.join(filters)}"

    query += """
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
    due_date = get_optional_date(payload, "due_date")
    status = get_optional_choice(payload, "status", allowed=TASK_STATUSES, default="pending") or "pending"
    project_id = get_optional_int(payload, "project_id", minimum=1)
    goal_id = get_optional_int(payload, "goal_id", minimum=1)
    completed_at = iso_now() if status == "completed" else None

    task_id = execute_db(
        """
        INSERT INTO tasks (title, description, priority, due_date, status, project_id, goal_id, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (title, description, priority, due_date, status, project_id, goal_id, completed_at),
    )
    task = query_db("SELECT * FROM tasks WHERE id = ?", [task_id], one=True)
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
    due_date = get_optional_date(payload, "due_date") if "due_date" in payload else current_task["due_date"]
    project_id = get_optional_int(payload, "project_id", default=current_task["project_id"], minimum=1)
    goal_id = get_optional_int(payload, "goal_id", default=current_task["goal_id"], minimum=1)

    completed_at = current_task.get("completed_at")
    if status == "completed" and current_task["status"] != "completed":
        completed_at = iso_now()
    elif status != "completed":
        completed_at = None

    execute_db(
        """
        UPDATE tasks
        SET title = ?, description = ?, priority = ?, status = ?, due_date = ?, project_id = ?, goal_id = ?, completed_at = ?
        WHERE id = ?
        """,
        (title, description, priority, status, due_date, project_id, goal_id, completed_at, task_id),
    )
    updated_task = query_db("SELECT * FROM tasks WHERE id = ?", [task_id], one=True)
    return jsonify({"task": row_to_dict(updated_task), "message": "Task updated."})


@bp.route("/<int:task_id>", methods=["DELETE"])
def delete_task(task_id: int):
    task = query_db("SELECT id FROM tasks WHERE id = ?", [task_id], one=True)
    if not task:
        return jsonify({"error": "Task not found."}), 404

    execute_db("DELETE FROM tasks WHERE id = ?", [task_id])
    return jsonify({"message": "Task deleted."})
