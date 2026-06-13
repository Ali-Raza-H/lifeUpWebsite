from __future__ import annotations

from flask import Blueprint, jsonify, request

from database import ensure_project_notebook_folder, execute_db, get_db, query_db
from services import fetch_project_metrics, maybe_create_linkedin_draft_for_project
from utils import (
    get_optional_bool,
    get_optional_choice,
    get_optional_date,
    get_optional_int,
    get_optional_string,
    get_required_string,
    iso_now,
    require_object,
    row_to_dict,
    validate_optional_reference,
)

bp = Blueprint("projects_api", __name__, url_prefix="/api/projects")

PROJECT_STATUSES = {"planning", "active", "paused", "completed", "archived"}
MILESTONE_STATUSES = {"pending", "in_progress", "completed"}


@bp.route("/", methods=["GET"])
def get_projects():
    return jsonify(fetch_project_metrics())

@bp.route("/<int:project_id>", methods=["GET"])
def get_project(project_id: int):
    project = query_db("SELECT * FROM projects WHERE id = ?", [project_id], one=True)
    if not project:
        return jsonify({"error": "Project not found."}), 404
    
    project_dict = row_to_dict(project)
    
    # Fetch linked habits
    habits = query_db(
        """
        SELECT h.* FROM habits h
        JOIN project_habits ph ON h.id = ph.habit_id
        WHERE ph.project_id = ?
        """,
        [project_id]
    )
    project_dict["habits"] = [row_to_dict(h) for h in habits]

    milestones = query_db(
        """
        SELECT *
        FROM project_milestones
        WHERE project_id = ?
        ORDER BY
            CASE status WHEN 'completed' THEN 1 ELSE 0 END,
            COALESCE(due_date, '9999-12-31') ASC,
            created_at DESC,
            id DESC
        """,
        [project_id]
    )
    project_dict["milestones"] = [row_to_dict(item) for item in milestones]

    resources = query_db(
        """
        SELECT *
        FROM attachments
        WHERE entity_type = 'project' AND entity_id = ?
        ORDER BY is_favorite DESC, created_at DESC, id DESC
        """,
        [project_id]
    )
    project_dict["resources"] = [row_to_dict(item) for item in resources]
    
    return jsonify(project_dict)


@bp.route("/", methods=["POST"])
def create_project():
    payload = require_object(request.get_json(silent=True))
    name = get_required_string(payload, "name", max_length=140)
    description = get_optional_string(payload, "description", max_length=2000, default="") or ""
    notes = get_optional_string(payload, "notes", max_length=10000, default="") or ""
    goal_id = get_optional_int(payload, "goal_id", minimum=1)
    validate_optional_reference(goal_id, "goals", field="goal_id", label="Goal")
    deadline = get_optional_date(payload, "deadline")
    status = get_optional_choice(payload, "status", allowed=PROJECT_STATUSES, default="planning") or "planning"
    linkedin_post_enabled = 1 if get_optional_bool(payload, "linkedin_post_enabled", default=False) else 0
    completed_at = iso_now() if status == "completed" else None

    project_id = execute_db(
        """
        INSERT INTO projects (name, description, notes, goal_id, status, deadline, linkedin_post_enabled, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (name, description, notes, goal_id, status, deadline, linkedin_post_enabled, completed_at),
    )
    project = query_db("SELECT * FROM projects WHERE id = ?", [project_id], one=True)
    ensure_project_notebook_folder(project_id, name)
    get_db().commit()
    if status == "completed" and linkedin_post_enabled:
        maybe_create_linkedin_draft_for_project(project_id)
    return jsonify({"project": row_to_dict(project), "message": "Project created."}), 201


@bp.route("/<int:project_id>", methods=["PUT"])
def update_project(project_id: int):
    project = query_db("SELECT * FROM projects WHERE id = ?", [project_id], one=True)
    if not project:
        return jsonify({"error": "Project not found."}), 404

    payload = require_object(request.get_json(silent=True))
    current_project = row_to_dict(project)

    name = get_optional_string(payload, "name", max_length=140, default=current_project["name"]) or current_project["name"]
    description = (
        get_optional_string(payload, "description", max_length=2000, default=current_project["description"])
        if "description" in payload
        else current_project["description"]
    )
    notes = (
        get_optional_string(payload, "notes", max_length=10000, default=current_project["notes"])
        if "notes" in payload
        else current_project["notes"]
    )
    goal_id = (
        get_optional_int(payload, "goal_id", minimum=1)
        if "goal_id" in payload
        else current_project["goal_id"]
    )
    validate_optional_reference(goal_id, "goals", field="goal_id", label="Goal")
    deadline = get_optional_date(payload, "deadline") if "deadline" in payload else current_project["deadline"]
    status = (
        get_optional_choice(payload, "status", allowed=PROJECT_STATUSES, default=current_project["status"])
        or current_project["status"]
    )
    linkedin_post_enabled = (
        1
        if get_optional_bool(payload, "linkedin_post_enabled", default=bool(current_project.get("linkedin_post_enabled")))
        else 0
    )

    completed_at = current_project.get("completed_at")
    if status == "completed" and current_project["status"] != "completed":
        completed_at = iso_now()
    elif status != "completed":
        completed_at = None

    execute_db(
        """
        UPDATE projects
        SET name = ?, description = ?, notes = ?, goal_id = ?, status = ?, deadline = ?, linkedin_post_enabled = ?, completed_at = ?
        WHERE id = ?
        """,
        (name, description, notes, goal_id, status, deadline, linkedin_post_enabled, completed_at, project_id),
    )
    updated = query_db("SELECT * FROM projects WHERE id = ?", [project_id], one=True)
    ensure_project_notebook_folder(project_id, name)
    get_db().commit()
    if status == "completed" and linkedin_post_enabled:
        maybe_create_linkedin_draft_for_project(project_id)
    return jsonify({"project": row_to_dict(updated), "message": "Project updated."})


@bp.route("/<int:project_id>", methods=["DELETE"])
def delete_project(project_id: int):
    project = query_db("SELECT id FROM projects WHERE id = ?", [project_id], one=True)
    if not project:
        return jsonify({"error": "Project not found."}), 404

    execute_db("DELETE FROM projects WHERE id = ?", [project_id])
    return jsonify({"message": "Project deleted."})

@bp.route("/<int:project_id>/habits", methods=["POST"])
def link_habit(project_id: int):
    payload = require_object(request.get_json(silent=True))
    habit_id = get_optional_int(payload, "habit_id", minimum=1)

    if not habit_id:
        return jsonify({"error": "habit_id is required."}), 400

    project = query_db("SELECT id FROM projects WHERE id = ?", [project_id], one=True)
    if not project:
        return jsonify({"error": "Project not found."}), 404

    habit = query_db("SELECT id FROM habits WHERE id = ?", [habit_id], one=True)
    if not habit:
        return jsonify({"error": "Habit not found."}), 404

    existing = query_db(
        "SELECT project_id, habit_id FROM project_habits WHERE project_id = ? AND habit_id = ?",
        [project_id, habit_id],
        one=True,
    )
    if existing:
        return jsonify({"message": "Habit already linked to project."})

    execute_db(
        "INSERT INTO project_habits (project_id, habit_id) VALUES (?, ?)",
        (project_id, habit_id),
    )
    return jsonify({"message": "Habit linked to project."})

@bp.route("/<int:project_id>/habits/<int:habit_id>", methods=["DELETE"])
def unlink_habit(project_id: int, habit_id: int):
    execute_db(
        "DELETE FROM project_habits WHERE project_id = ? AND habit_id = ?",
        (project_id, habit_id)
    )
    return jsonify({"message": "Habit unlinked from project."})


@bp.route("/<int:project_id>/milestones", methods=["POST"])
def create_milestone(project_id: int):
    project = query_db("SELECT id FROM projects WHERE id = ?", [project_id], one=True)
    if not project:
        return jsonify({"error": "Project not found."}), 404

    payload = require_object(request.get_json(silent=True))
    title = get_required_string(payload, "title", max_length=160)
    status = get_optional_choice(payload, "status", allowed=MILESTONE_STATUSES, default="pending") or "pending"
    due_date = get_optional_date(payload, "due_date")
    completed_at = iso_now() if status == "completed" else None

    milestone_id = execute_db(
        """
        INSERT INTO project_milestones (project_id, title, status, due_date, completed_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (project_id, title, status, due_date, completed_at),
    )
    milestone = query_db("SELECT * FROM project_milestones WHERE id = ?", [milestone_id], one=True)
    return jsonify({"milestone": row_to_dict(milestone), "message": "Milestone created."}), 201


@bp.route("/<int:project_id>/milestones/<int:milestone_id>", methods=["PUT"])
def update_milestone(project_id: int, milestone_id: int):
    milestone = query_db(
        "SELECT * FROM project_milestones WHERE id = ? AND project_id = ?",
        [milestone_id, project_id],
        one=True,
    )
    if not milestone:
        return jsonify({"error": "Milestone not found."}), 404

    current = row_to_dict(milestone)
    payload = require_object(request.get_json(silent=True))
    title = get_optional_string(payload, "title", max_length=160, default=current["title"]) or current["title"]
    status = get_optional_choice(payload, "status", allowed=MILESTONE_STATUSES, default=current["status"]) or current["status"]
    due_date = get_optional_date(payload, "due_date") if "due_date" in payload else current["due_date"]
    completed_at = current.get("completed_at")
    if status == "completed" and current["status"] != "completed":
        completed_at = iso_now()
    elif status != "completed":
        completed_at = None

    execute_db(
        """
        UPDATE project_milestones
        SET title = ?, status = ?, due_date = ?, completed_at = ?
        WHERE id = ?
        """,
        (title, status, due_date, completed_at, milestone_id),
    )
    updated = query_db("SELECT * FROM project_milestones WHERE id = ?", [milestone_id], one=True)
    return jsonify({"milestone": row_to_dict(updated), "message": "Milestone updated."})


@bp.route("/<int:project_id>/milestones/<int:milestone_id>", methods=["DELETE"])
def delete_milestone(project_id: int, milestone_id: int):
    milestone = query_db(
        "SELECT id FROM project_milestones WHERE id = ? AND project_id = ?",
        [milestone_id, project_id],
        one=True,
    )
    if not milestone:
        return jsonify({"error": "Milestone not found."}), 404

    execute_db("DELETE FROM project_milestones WHERE id = ?", [milestone_id])
    return jsonify({"message": "Milestone deleted."})
