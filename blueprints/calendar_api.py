from __future__ import annotations

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from services import build_week_schedule_payload
from utils import (
    ValidationError,
    get_optional_choice,
    get_optional_date,
    get_optional_datetime,
    get_optional_int,
    get_optional_string,
    get_required_string,
    parse_datetime,
    require_object,
)

bp = Blueprint("calendar_api", __name__, url_prefix="/api/calendar")
RECURRENCE_OPTIONS = {"none", "daily", "weekly", "monthly"}


def _validate_event_window(start_at: str, end_at: str) -> tuple[str, str]:
    start_dt = parse_datetime(start_at)
    end_dt = parse_datetime(end_at)
    if start_dt is None or end_dt is None:
        raise ValidationError("Start and end times are required.")
    if end_dt <= start_dt:
        raise ValidationError("End time must be after the start time.", "end_at")
    if start_dt.date() != end_dt.date():
        raise ValidationError("Events must start and end on the same day for the weekly timetable.", "end_at")
    return start_dt.isoformat(sep=" "), end_dt.isoformat(sep=" ")


@bp.route("/week", methods=["GET"])
def get_week():
    week = request.args.get("start")
    try:
        payload = build_week_schedule_payload(week)
    except ValueError as exc:
        raise ValidationError(str(exc), "start") from exc
    return jsonify(payload)


@bp.route("/events", methods=["POST"])
def create_event():
    payload = require_object(request.get_json(silent=True))
    title = get_required_string(payload, "title", max_length=160)
    description = get_optional_string(payload, "description", max_length=2000, default="") or ""
    category = get_optional_string(payload, "category", max_length=80, default="general") or "general"
    location = get_optional_string(payload, "location", max_length=140, default="") or ""
    project_id = get_optional_int(payload, "project_id", minimum=1)
    goal_id = get_optional_int(payload, "goal_id", minimum=1)
    recurrence = get_optional_choice(payload, "recurrence", allowed=RECURRENCE_OPTIONS, default="none") or "none"
    recurrence_until = get_optional_date(payload, "recurrence_until")
    start_at = get_optional_datetime(payload, "start_at")
    end_at = get_optional_datetime(payload, "end_at")
    if start_at is None or end_at is None:
        raise ValidationError("Start and end times are required.")
    start_at, end_at = _validate_event_window(start_at, end_at)

    event_id = execute_db(
        """
        INSERT INTO calendar_events (title, description, category, location, project_id, goal_id, start_at, end_at, recurrence, recurrence_until, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (title, description, category, location, project_id, goal_id, start_at, end_at, recurrence, recurrence_until),
    )
    event = query_db("SELECT * FROM calendar_events WHERE id = ?", [event_id], one=True)
    return jsonify({"event": dict(event), "message": "Event created."}), 201


@bp.route("/events/<int:event_id>", methods=["PUT"])
def update_event(event_id: int):
    event = query_db("SELECT * FROM calendar_events WHERE id = ?", [event_id], one=True)
    if not event:
        return jsonify({"error": "Event not found."}), 404

    current = dict(event)
    payload = require_object(request.get_json(silent=True))
    title = get_required_string({"title": payload.get("title", current["title"])}, "title", max_length=160)
    description = get_optional_string(payload, "description", max_length=2000, default=current["description"])
    category = get_optional_string(payload, "category", max_length=80, default=current["category"])
    location = get_optional_string(payload, "location", max_length=140, default=current["location"])
    project_id = get_optional_int(payload, "project_id", default=current.get("project_id"), minimum=1)
    goal_id = get_optional_int(payload, "goal_id", default=current.get("goal_id"), minimum=1)
    recurrence = get_optional_choice(
        payload,
        "recurrence",
        allowed=RECURRENCE_OPTIONS,
        default=current.get("recurrence") or "none",
    ) or "none"
    recurrence_until = get_optional_date(payload, "recurrence_until") if "recurrence_until" in payload else current.get("recurrence_until")
    start_at = get_optional_datetime(payload, "start_at") if "start_at" in payload else current["start_at"]
    end_at = get_optional_datetime(payload, "end_at") if "end_at" in payload else current["end_at"]
    start_at, end_at = _validate_event_window(start_at, end_at)

    execute_db(
        """
        UPDATE calendar_events
        SET title = ?, description = ?, category = ?, location = ?, project_id = ?, goal_id = ?, start_at = ?, end_at = ?, recurrence = ?, recurrence_until = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (title, description, category, location, project_id, goal_id, start_at, end_at, recurrence, recurrence_until, event_id),
    )
    updated = query_db("SELECT * FROM calendar_events WHERE id = ?", [event_id], one=True)
    return jsonify({"event": dict(updated), "message": "Event updated."})


@bp.route("/events/<int:event_id>", methods=["DELETE"])
def delete_event(event_id: int):
    event = query_db("SELECT id FROM calendar_events WHERE id = ?", [event_id], one=True)
    if not event:
        return jsonify({"error": "Event not found."}), 404

    execute_db("DELETE FROM calendar_events WHERE id = ?", [event_id])
    return jsonify({"message": "Event deleted."})
