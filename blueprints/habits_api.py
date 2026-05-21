from __future__ import annotations

from datetime import date

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from services import build_habit_calendar_payload, serialize_habits_with_metrics
from utils import (
    ValidationError,
    get_optional_choice,
    get_optional_date,
    get_optional_int,
    get_optional_string,
    get_required_string,
    require_object,
    row_to_dict,
)

bp = Blueprint("habits_api", __name__, url_prefix="/api/habits")

HABIT_FREQUENCIES = {"daily", "weekly", "monthly"}
HABIT_STATUSES = {"completed", "failed", "skipped"}


@bp.route("/", methods=["GET"])
def get_habits():
    return jsonify(serialize_habits_with_metrics())


@bp.route("/calendar", methods=["GET"])
def get_habit_calendar():
    month = request.args.get("month")
    try:
        payload = build_habit_calendar_payload(month)
    except ValueError as exc:
        raise ValidationError(str(exc), "month") from exc
    return jsonify(payload)


@bp.route("/", methods=["POST"])
def create_habit():
    payload = require_object(request.get_json(silent=True))
    name = get_required_string(payload, "name", max_length=140)
    description = get_optional_string(payload, "description", max_length=2000, default="") or ""
    frequency = get_optional_choice(payload, "frequency", allowed=HABIT_FREQUENCIES, default="daily") or "daily"
    category = get_optional_string(payload, "category", max_length=100, default="general") or "general"
    target_streak = get_optional_int(payload, "target_streak", default=0, minimum=0, maximum=3650) or 0

    habit_id = execute_db(
        """
        INSERT INTO habits (name, description, frequency, category, target_streak)
        VALUES (?, ?, ?, ?, ?)
        """,
        (name, description, frequency, category, target_streak),
    )
    habit = query_db("SELECT * FROM habits WHERE id = ?", [habit_id], one=True)
    return jsonify({"habit": row_to_dict(habit), "message": "Habit created."}), 201


@bp.route("/<int:habit_id>", methods=["PUT"])
def update_habit(habit_id: int):
    habit = query_db("SELECT * FROM habits WHERE id = ?", [habit_id], one=True)
    if not habit:
        return jsonify({"error": "Habit not found."}), 404

    payload = require_object(request.get_json(silent=True))
    current = row_to_dict(habit)
    name = get_required_string({"name": payload.get("name", current["name"])}, "name", max_length=140)
    description = (
        get_optional_string(payload, "description", max_length=2000, default=current["description"])
        if "description" in payload
        else current["description"]
    )
    frequency = get_optional_choice(payload, "frequency", allowed=HABIT_FREQUENCIES, default=current["frequency"]) or current["frequency"]
    category = get_optional_string(payload, "category", max_length=100, default=current["category"]) or current["category"]
    target_streak = get_optional_int(payload, "target_streak", default=current["target_streak"], minimum=0, maximum=3650)

    execute_db(
        """
        UPDATE habits
        SET name = ?, description = ?, frequency = ?, category = ?, target_streak = ?
        WHERE id = ?
        """,
        (name, description, frequency, category, target_streak, habit_id),
    )
    updated = query_db("SELECT * FROM habits WHERE id = ?", [habit_id], one=True)
    return jsonify({"habit": row_to_dict(updated), "message": "Habit updated."})


@bp.route("/<int:habit_id>/log", methods=["POST"])
def log_habit(habit_id: int):
    habit = query_db("SELECT * FROM habits WHERE id = ?", [habit_id], one=True)
    if not habit:
        return jsonify({"error": "Habit not found."}), 404

    payload = require_object(request.get_json(silent=True))
    log_date = get_optional_date(payload, "date") or date.today().isoformat()
    status = get_optional_choice(payload, "status", allowed=HABIT_STATUSES, default="completed") or "completed"
    if date.fromisoformat(log_date) > date.today():
        raise ValidationError("Future habit tracking is not allowed.", "date")

    existing_log = query_db(
        "SELECT id FROM habit_logs WHERE habit_id = ? AND log_date = ?",
        [habit_id, log_date],
        one=True,
    )
    if existing_log:
        execute_db("UPDATE habit_logs SET status = ? WHERE id = ?", (status, existing_log["id"]))
    else:
        execute_db(
            "INSERT INTO habit_logs (habit_id, log_date, status) VALUES (?, ?, ?)",
            (habit_id, log_date, status),
        )

    updated_habit = next((item for item in serialize_habits_with_metrics() if item["id"] == habit_id), None)
    return jsonify({"habit": updated_habit, "message": "Habit logged."})


@bp.route("/<int:habit_id>/logs", methods=["GET"])
def get_habit_logs(habit_id: int):
    habit = query_db("SELECT id FROM habits WHERE id = ?", [habit_id], one=True)
    if not habit:
        return jsonify({"error": "Habit not found."}), 404

    logs = query_db(
        "SELECT * FROM habit_logs WHERE habit_id = ? ORDER BY log_date DESC, id DESC",
        [habit_id],
    )
    return jsonify([dict(log) for log in logs])


@bp.route("/<int:habit_id>", methods=["DELETE"])
def delete_habit(habit_id: int):
    habit = query_db("SELECT id FROM habits WHERE id = ?", [habit_id], one=True)
    if not habit:
        return jsonify({"error": "Habit not found."}), 404

    execute_db("DELETE FROM habits WHERE id = ?", [habit_id])
    return jsonify({"message": "Habit deleted."})
