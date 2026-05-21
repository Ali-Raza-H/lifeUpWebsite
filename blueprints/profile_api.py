from __future__ import annotations

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from services import get_skills_payload, seed_profile_defaults
from utils import (
    get_optional_choice,
    get_optional_int,
    get_optional_string,
    get_required_string,
    require_object,
    rows_to_dicts,
)

bp = Blueprint("profile_api", __name__, url_prefix="/api/profile")
SKILL_CATEGORIES = {"language", "framework", "tool", "database", "platform", "other"}
EXPERIENCE_LEVELS = {"beginner", "intermediate", "advanced", "expert"}


@bp.route("/traits", methods=["GET"])
def get_traits():
    seed_profile_defaults()
    traits = query_db("SELECT * FROM traits ORDER BY score DESC, name ASC")
    return jsonify(rows_to_dicts(traits))


@bp.route("/traits/<int:trait_id>", methods=["PUT"])
def update_trait(trait_id: int):
    trait = query_db("SELECT * FROM traits WHERE id = ?", [trait_id], one=True)
    if not trait:
        return jsonify({"error": "Trait not found."}), 404

    payload = request.get_json(silent=True) or {}
    score = get_optional_int(payload, "score", minimum=0, maximum=100)
    if score is None:
        return jsonify({"error": "Score is required.", "field": "score"}), 400

    execute_db(
        "UPDATE traits SET score = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?",
        (score, trait_id),
    )
    updated = query_db("SELECT * FROM traits WHERE id = ?", [trait_id], one=True)
    return jsonify({"trait": dict(updated), "message": "Trait updated."})


@bp.route("/beliefs", methods=["GET"])
def get_beliefs():
    seed_profile_defaults()
    beliefs = query_db("SELECT * FROM beliefs ORDER BY display_order ASC, id ASC")
    return jsonify(rows_to_dicts(beliefs))


@bp.route("/skills", methods=["GET"])
def get_skills():
    seed_profile_defaults()
    return jsonify(get_skills_payload())


@bp.route("/skills", methods=["POST"])
def create_skill():
    payload = require_object(request.get_json(silent=True))
    name = get_required_string(payload, "name", max_length=120)
    category = get_optional_choice(payload, "category", allowed=SKILL_CATEGORIES, default="other") or "other"
    proficiency = get_optional_int(payload, "proficiency", default=50, minimum=0, maximum=100) or 50
    experience_level = (
        get_optional_choice(payload, "experience_level", allowed=EXPERIENCE_LEVELS, default="intermediate")
        or "intermediate"
    )
    notes = get_optional_string(payload, "notes", max_length=2000, default="") or ""
    display_order = get_optional_int(payload, "display_order", default=0, minimum=0) or 0

    skill_id = execute_db(
        """
        INSERT INTO skills (name, category, proficiency, experience_level, notes, display_order, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (name, category, proficiency, experience_level, notes, display_order),
    )
    skill = query_db("SELECT * FROM skills WHERE id = ?", [skill_id], one=True)
    return jsonify({"skill": dict(skill), "message": "Skill created."}), 201


@bp.route("/skills/<int:skill_id>", methods=["PUT"])
def update_skill(skill_id: int):
    skill = query_db("SELECT * FROM skills WHERE id = ?", [skill_id], one=True)
    if not skill:
        return jsonify({"error": "Skill not found."}), 404

    payload = require_object(request.get_json(silent=True))
    current = dict(skill)
    name = get_required_string({"name": payload.get("name", current["name"])}, "name", max_length=120)
    category = get_optional_choice(payload, "category", allowed=SKILL_CATEGORIES, default=current["category"]) or current["category"]
    proficiency = get_optional_int(payload, "proficiency", default=current["proficiency"], minimum=0, maximum=100)
    experience_level = (
        get_optional_choice(payload, "experience_level", allowed=EXPERIENCE_LEVELS, default=current["experience_level"])
        or current["experience_level"]
    )
    notes = get_optional_string(payload, "notes", max_length=2000, default=current["notes"])
    display_order = get_optional_int(payload, "display_order", default=current["display_order"], minimum=0)

    execute_db(
        """
        UPDATE skills
        SET name = ?, category = ?, proficiency = ?, experience_level = ?, notes = ?, display_order = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (name, category, proficiency, experience_level, notes, display_order, skill_id),
    )
    updated = query_db("SELECT * FROM skills WHERE id = ?", [skill_id], one=True)
    return jsonify({"skill": dict(updated), "message": "Skill updated."})


@bp.route("/skills/<int:skill_id>", methods=["DELETE"])
def delete_skill(skill_id: int):
    skill = query_db("SELECT id FROM skills WHERE id = ?", [skill_id], one=True)
    if not skill:
        return jsonify({"error": "Skill not found."}), 404

    execute_db("DELETE FROM skills WHERE id = ?", [skill_id])
    return jsonify({"message": "Skill deleted."})
