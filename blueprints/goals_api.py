from __future__ import annotations

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from services import fetch_goal_metrics
from utils import (
    get_optional_choice,
    get_optional_date,
    get_required_string,
    iso_now,
    require_object,
    row_to_dict,
)

bp = Blueprint("goals_api", __name__, url_prefix="/api/goals")

GOAL_TYPES = {"short-term", "long-term", "identity", "skill"}
GOAL_STATUSES = {"active", "paused", "completed", "archived"}


@bp.route("/", methods=["GET"])
def get_goals():
    return jsonify(fetch_goal_metrics())


@bp.route("/", methods=["POST"])
def create_goal():
    payload = require_object(request.get_json(silent=True))
    title = get_required_string(payload, "title", max_length=160)
    goal_type = get_optional_choice(payload, "type", allowed=GOAL_TYPES, default="short-term") or "short-term"
    target_date = get_optional_date(payload, "target_date")
    status = get_optional_choice(payload, "status", allowed=GOAL_STATUSES, default="active") or "active"
    completed_at = iso_now() if status == "completed" else None

    goal_id = execute_db(
        """
        INSERT INTO goals (title, type, target_date, status, completed_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (title, goal_type, target_date, status, completed_at),
    )
    goal = query_db("SELECT * FROM goals WHERE id = ?", [goal_id], one=True)
    return jsonify({"goal": row_to_dict(goal), "message": "Goal created."}), 201


@bp.route("/<int:goal_id>", methods=["PUT"])
def update_goal(goal_id: int):
    goal = query_db("SELECT * FROM goals WHERE id = ?", [goal_id], one=True)
    if not goal:
        return jsonify({"error": "Goal not found."}), 404

    payload = require_object(request.get_json(silent=True))
    current_goal = row_to_dict(goal)

    title = get_required_string({"title": payload.get("title", current_goal["title"])}, "title", max_length=160)
    goal_type = get_optional_choice(payload, "type", allowed=GOAL_TYPES, default=current_goal["type"]) or current_goal["type"]
    target_date = get_optional_date(payload, "target_date") if "target_date" in payload else current_goal["target_date"]
    status = get_optional_choice(payload, "status", allowed=GOAL_STATUSES, default=current_goal["status"]) or current_goal["status"]

    completed_at = current_goal.get("completed_at")
    if status == "completed" and current_goal["status"] != "completed":
        completed_at = iso_now()
    elif status != "completed":
        completed_at = None

    execute_db(
        """
        UPDATE goals
        SET title = ?, type = ?, target_date = ?, status = ?, completed_at = ?
        WHERE id = ?
        """,
        (title, goal_type, target_date, status, completed_at, goal_id),
    )
    updated = query_db("SELECT * FROM goals WHERE id = ?", [goal_id], one=True)
    return jsonify({"goal": row_to_dict(updated), "message": "Goal updated."})


@bp.route("/<int:goal_id>", methods=["DELETE"])
def delete_goal(goal_id: int):
    goal = query_db("SELECT id FROM goals WHERE id = ?", [goal_id], one=True)
    if not goal:
        return jsonify({"error": "Goal not found."}), 404

    execute_db("DELETE FROM goals WHERE id = ?", [goal_id])
    return jsonify({"message": "Goal deleted."})
