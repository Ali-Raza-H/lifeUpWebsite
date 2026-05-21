from __future__ import annotations

from flask import Blueprint, jsonify, request

from database import query_db
from services import (
    activity_series,
    build_habit_calendar_payload,
    consistency_rate,
    serialize_habits_with_metrics,
    weekly_completion_series,
)
from utils import ValidationError

bp = Blueprint("analytics_api", __name__, url_prefix="/api/analytics")


@bp.route("/overview", methods=["GET"])
def get_overview():
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

    return jsonify(
        {
            "completed_tasks": int(completed_tasks or 0),
            "active_habits": int(active_habits or 0),
            "active_projects": int(active_projects or 0),
            "active_goals": int(active_goals or 0),
            "consistency": consistency_rate(),
            "system_status": "Nominal",
        }
    )


@bp.route("/habits_monthly", methods=["GET"])
def habits_monthly():
    habits = build_habit_calendar_payload()["habits"]
    report = [
        {
            "id": habit["id"],
            "name": habit["name"],
            "completed_days": habit["month_completed_days"],
            "target_days": habit["month_target_days"],
            "completion_rate": habit["month_completion_rate"],
        }
        for habit in habits
    ]
    return jsonify(report)


@bp.route("/habit_calendar", methods=["GET"])
def habit_calendar():
    month = request.args.get("month")
    try:
        payload = build_habit_calendar_payload(month)
    except ValueError as exc:
        raise ValidationError(str(exc), "month") from exc
    return jsonify(payload)


@bp.route("/activity", methods=["GET"])
def get_activity():
    return jsonify(activity_series())


@bp.route("/velocity", methods=["GET"])
def get_velocity():
    return jsonify(weekly_completion_series())
