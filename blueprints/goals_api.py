from __future__ import annotations

from flask import Blueprint, jsonify, request
from urllib.parse import urlparse

from database import execute_db, query_db
from services import fetch_goal_metrics
from utils import (
    ValidationError,
    get_optional_choice,
    get_optional_date,
    get_optional_string,
    get_required_string,
    iso_now,
    require_object,
    row_to_dict,
    rows_to_dicts,
)

bp = Blueprint("goals_api", __name__, url_prefix="/api/goals")

GOAL_TYPES = {"short-term", "long-term", "identity", "skill"}
GOAL_STATUSES = {"active", "paused", "completed", "archived"}
MILESTONE_STATUSES = {"pending", "in_progress", "completed"}


def normalize_url(value: str) -> str:
    clean_value = value.strip()
    if not clean_value:
        raise ValidationError("Url is required.", "url")
    if "://" not in clean_value:
        clean_value = f"https://{clean_value}"
    parsed = urlparse(clean_value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValidationError("Url must be a valid website link.", "url")
    return clean_value


@bp.route("/", methods=["GET"])
def get_goals():
    return jsonify(fetch_goal_metrics())


@bp.route("/", methods=["POST"])
def create_goal():
    payload = require_object(request.get_json(silent=True))
    title = get_required_string(payload, "title", max_length=160)
    goal_type = get_optional_choice(payload, "type", allowed=GOAL_TYPES, default="short-term") or "short-term"
    notes = get_optional_string(payload, "notes", max_length=8000, default="") or ""
    target_date = get_optional_date(payload, "target_date")
    status = get_optional_choice(payload, "status", allowed=GOAL_STATUSES, default="active") or "active"
    completed_at = iso_now() if status == "completed" else None

    goal_id = execute_db(
        """
        INSERT INTO goals (title, type, notes, target_date, status, completed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (title, goal_type, notes, target_date, status, completed_at),
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
    notes = (
        get_optional_string(payload, "notes", max_length=8000, default=current_goal.get("notes", ""))
        if "notes" in payload
        else current_goal.get("notes", "")
    )
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
        SET title = ?, type = ?, notes = ?, target_date = ?, status = ?, completed_at = ?
        WHERE id = ?
        """,
        (title, goal_type, notes, target_date, status, completed_at, goal_id),
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


@bp.route("/<int:goal_id>/links", methods=["GET"])
def get_goal_links(goal_id: int):
    goal = query_db("SELECT id FROM goals WHERE id = ?", [goal_id], one=True)
    if not goal:
        return jsonify({"error": "Goal not found."}), 404

    rows = query_db(
        "SELECT * FROM goal_links WHERE goal_id = ? ORDER BY created_at DESC, id DESC",
        [goal_id],
    )
    return jsonify(rows_to_dicts(rows))


@bp.route("/<int:goal_id>/links", methods=["POST"])
def create_goal_link(goal_id: int):
    goal = query_db("SELECT id FROM goals WHERE id = ?", [goal_id], one=True)
    if not goal:
        return jsonify({"error": "Goal not found."}), 404

    payload = require_object(request.get_json(silent=True))
    title = get_required_string(payload, "title", max_length=120)
    raw_url = get_required_string(payload, "url", max_length=1000)
    url = normalize_url(raw_url)

    link_id = execute_db(
        """
        INSERT INTO goal_links (goal_id, title, url)
        VALUES (?, ?, ?)
        """,
        (goal_id, title, url),
    )
    link = query_db("SELECT * FROM goal_links WHERE id = ?", [link_id], one=True)
    return jsonify({"link": row_to_dict(link), "message": "Goal link added."}), 201


@bp.route("/<int:goal_id>/links/<int:link_id>", methods=["DELETE"])
def delete_goal_link(goal_id: int, link_id: int):
    link = query_db(
        "SELECT id FROM goal_links WHERE id = ? AND goal_id = ?",
        [link_id, goal_id],
        one=True,
    )
    if not link:
        return jsonify({"error": "Goal link not found."}), 404

    execute_db("DELETE FROM goal_links WHERE id = ?", [link_id])
    return jsonify({"message": "Goal link deleted."})


@bp.route("/<int:goal_id>/milestones", methods=["POST"])
def create_goal_milestone(goal_id: int):
    goal = query_db("SELECT id FROM goals WHERE id = ?", [goal_id], one=True)
    if not goal:
        return jsonify({"error": "Goal not found."}), 404

    payload = require_object(request.get_json(silent=True))
    title = get_required_string(payload, "title", max_length=160)
    status = get_optional_choice(payload, "status", allowed=MILESTONE_STATUSES, default="pending") or "pending"
    due_date = get_optional_date(payload, "due_date")
    completed_at = iso_now() if status == "completed" else None

    milestone_id = execute_db(
        """
        INSERT INTO goal_milestones (goal_id, title, status, due_date, completed_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (goal_id, title, status, due_date, completed_at),
    )
    milestone = query_db("SELECT * FROM goal_milestones WHERE id = ?", [milestone_id], one=True)
    return jsonify({"milestone": row_to_dict(milestone), "message": "Goal milestone created."}), 201


@bp.route("/<int:goal_id>/milestones/<int:milestone_id>", methods=["PUT"])
def update_goal_milestone(goal_id: int, milestone_id: int):
    milestone = query_db(
        "SELECT * FROM goal_milestones WHERE id = ? AND goal_id = ?",
        [milestone_id, goal_id],
        one=True,
    )
    if not milestone:
        return jsonify({"error": "Goal milestone not found."}), 404

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
        UPDATE goal_milestones
        SET title = ?, status = ?, due_date = ?, completed_at = ?
        WHERE id = ?
        """,
        (title, status, due_date, completed_at, milestone_id),
    )
    updated = query_db("SELECT * FROM goal_milestones WHERE id = ?", [milestone_id], one=True)
    return jsonify({"milestone": row_to_dict(updated), "message": "Goal milestone updated."})


@bp.route("/<int:goal_id>/milestones/<int:milestone_id>", methods=["DELETE"])
def delete_goal_milestone(goal_id: int, milestone_id: int):
    milestone = query_db(
        "SELECT id FROM goal_milestones WHERE id = ? AND goal_id = ?",
        [milestone_id, goal_id],
        one=True,
    )
    if not milestone:
        return jsonify({"error": "Goal milestone not found."}), 404

    execute_db("DELETE FROM goal_milestones WHERE id = ?", [milestone_id])
    return jsonify({"message": "Goal milestone deleted."})
