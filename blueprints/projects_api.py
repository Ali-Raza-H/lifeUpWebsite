from __future__ import annotations

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from services import fetch_project_metrics
from utils import (
    get_optional_choice,
    get_optional_date,
    get_optional_string,
    get_required_string,
    iso_now,
    require_object,
    row_to_dict,
)

bp = Blueprint("projects_api", __name__, url_prefix="/api/projects")

PROJECT_STATUSES = {"active", "paused", "completed", "archived"}


@bp.route("/", methods=["GET"])
def get_projects():
    return jsonify(fetch_project_metrics())


@bp.route("/", methods=["POST"])
def create_project():
    payload = require_object(request.get_json(silent=True))
    name = get_required_string(payload, "name", max_length=140)
    description = get_optional_string(payload, "description", max_length=2000, default="") or ""
    deadline = get_optional_date(payload, "deadline")
    status = get_optional_choice(payload, "status", allowed=PROJECT_STATUSES, default="active") or "active"
    completed_at = iso_now() if status == "completed" else None

    project_id = execute_db(
        """
        INSERT INTO projects (name, description, status, deadline, completed_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (name, description, status, deadline, completed_at),
    )
    project = query_db("SELECT * FROM projects WHERE id = ?", [project_id], one=True)
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
    deadline = get_optional_date(payload, "deadline") if "deadline" in payload else current_project["deadline"]
    status = (
        get_optional_choice(payload, "status", allowed=PROJECT_STATUSES, default=current_project["status"])
        or current_project["status"]
    )

    completed_at = current_project.get("completed_at")
    if status == "completed" and current_project["status"] != "completed":
        completed_at = iso_now()
    elif status != "completed":
        completed_at = None

    execute_db(
        """
        UPDATE projects
        SET name = ?, description = ?, status = ?, deadline = ?, completed_at = ?
        WHERE id = ?
        """,
        (name, description, status, deadline, completed_at, project_id),
    )
    updated = query_db("SELECT * FROM projects WHERE id = ?", [project_id], one=True)
    return jsonify({"project": row_to_dict(updated), "message": "Project updated."})


@bp.route("/<int:project_id>", methods=["DELETE"])
def delete_project(project_id: int):
    project = query_db("SELECT id FROM projects WHERE id = ?", [project_id], one=True)
    if not project:
        return jsonify({"error": "Project not found."}), 404

    execute_db("DELETE FROM projects WHERE id = ?", [project_id])
    return jsonify({"message": "Project deleted."})
