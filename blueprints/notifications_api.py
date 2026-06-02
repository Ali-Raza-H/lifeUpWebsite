from __future__ import annotations

from flask import Blueprint, jsonify

from services import build_notifications_payload

bp = Blueprint("notifications_api", __name__, url_prefix="/api/notifications")


@bp.route("/", methods=["GET"])
def get_notifications():
    return jsonify(build_notifications_payload())
