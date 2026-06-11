from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from database import query_db
from services import finalize_linkedin_draft_generation, generate_linkedin_draft, resend_linkedin_draft_email
from utils import get_required_string, require_object, row_to_dict, rows_to_dicts

bp = Blueprint("linkedin_api", __name__, url_prefix="/api/linkedin")


@bp.route("/config", methods=["GET"])
def get_linkedin_config():
    return jsonify(
        {
            "email_to": current_app.config.get("LINKEDIN_EMAIL_TO", "khadamalihussain@gmail.com"),
            "generation_mode": current_app.config.get("LINKEDIN_GENERATION_MODE", "server"),
            "provider": "google",
            "model": current_app.config.get("GEMINI_MODEL", "gemini-2.5-flash-lite"),
        }
    )


@bp.route("/drafts", methods=["GET"])
def get_linkedin_drafts():
    rows = query_db(
        """
        SELECT *
        FROM linkedin_drafts
        ORDER BY created_at DESC, id DESC
        LIMIT 120
        """
    )
    return jsonify(rows_to_dicts(rows))


@bp.route("/drafts/<int:draft_id>", methods=["GET"])
def get_linkedin_draft(draft_id: int):
    row = query_db("SELECT * FROM linkedin_drafts WHERE id = ?", [draft_id], one=True)
    if not row:
        return jsonify({"error": "LinkedIn draft not found."}), 404
    return jsonify(row_to_dict(row))


@bp.route("/drafts/<int:draft_id>/send", methods=["POST"])
def send_linkedin_draft(draft_id: int):
    draft = resend_linkedin_draft_email(draft_id)
    if not draft:
        return jsonify({"error": "LinkedIn draft not found."}), 404
    return jsonify({"draft": draft, "message": "LinkedIn draft email processed."})


@bp.route("/drafts/<int:draft_id>/generate", methods=["POST"])
def generate_linkedin_draft_route(draft_id: int):
    draft = generate_linkedin_draft(draft_id)
    if not draft:
        return jsonify({"error": "LinkedIn draft not found."}), 404
    return jsonify({"draft": draft, "message": "LinkedIn draft generated and email processed."})


@bp.route("/drafts/<int:draft_id>/generation", methods=["POST"])
def complete_linkedin_draft_generation(draft_id: int):
    payload = require_object(request.get_json(silent=True))
    post_body = get_required_string(payload, "post_body", max_length=2500)
    draft = finalize_linkedin_draft_generation(draft_id, post_body)
    if not draft:
        return jsonify({"error": "LinkedIn draft not found."}), 404
    return jsonify({"draft": draft, "message": "LinkedIn draft generated and email processed."})
