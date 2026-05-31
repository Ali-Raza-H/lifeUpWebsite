from __future__ import annotations

from flask import Blueprint, jsonify, request

from services import (
    activity_series,
    build_habit_calendar_payload,
    dashboard_overview_payload,
    dashboard_payload,
    dashboard_today_payload,
    get_traits_payload,
    habits_monthly_report,
    mood_productivity_series,
    weekly_completion_series,
)
from utils import ValidationError

bp = Blueprint("analytics_api", __name__, url_prefix="/api/analytics")


@bp.route("/overview", methods=["GET"])
def get_overview():
    return jsonify(dashboard_overview_payload())


@bp.route("/habits_monthly", methods=["GET"])
def habits_monthly():
    return jsonify(habits_monthly_report())


@bp.route("/dashboard", methods=["GET"])
def get_dashboard_payload():
    return jsonify(dashboard_payload())


@bp.route("/page", methods=["GET"])
def get_analytics_page_payload():
    month = request.args.get("month")
    try:
        calendar_payload = build_habit_calendar_payload(month)
    except ValueError as exc:
        raise ValidationError(str(exc), "month") from exc

    return jsonify(
        {
            "overview": dashboard_overview_payload(calendar_payload["habits"]),
            "velocity": weekly_completion_series(),
            "traits": get_traits_payload(),
            "calendar": calendar_payload,
            "mood_productivity": mood_productivity_series(),
        }
    )


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


@bp.route("/today", methods=["GET"])
def get_today():
    return jsonify(dashboard_today_payload())


@bp.route("/mood_productivity", methods=["GET"])
def get_mood_productivity():
    return jsonify(mood_productivity_series())
