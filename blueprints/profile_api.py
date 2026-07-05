from __future__ import annotations

from urllib.parse import urlparse

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from services import (
    get_beliefs_payload,
    get_profile_payload,
    get_skills_payload,
    get_traits_payload,
    seed_profile_defaults,
)
from utils import (
    ValidationError,
    get_optional_choice,
    get_optional_int,
    get_optional_string,
    get_required_string,
    require_object,
    row_to_dict,
    rows_to_dicts,
)

bp = Blueprint("profile_api", __name__, url_prefix="/api/profile")
SKILL_CATEGORIES = {"language", "framework", "tool", "database", "platform", "other"}
EXPERIENCE_LEVELS = {"beginner", "intermediate", "advanced", "expert"}


@bp.route("/all", methods=["GET"])
def get_profile():
    return jsonify(get_profile_payload())


@bp.route("/traits", methods=["GET"])
def get_traits():
    return jsonify(get_traits_payload())


@bp.route("/traits", methods=["POST"])
def create_trait():
    seed_profile_defaults()
    payload = require_object(request.get_json(silent=True))
    name = get_required_string(payload, "name", max_length=120)
    score = get_optional_int(payload, "score", default=50, minimum=0, maximum=100) or 50
    category = get_optional_string(payload, "category", max_length=80, default="general") or "general"
    display_order = get_optional_int(payload, "display_order", minimum=1) or _next_display_order("traits")

    trait_id = execute_db(
        """
        INSERT INTO traits (name, score, category, display_order, last_updated)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (name, score, category, display_order),
    )
    _normalize_display_order("traits")
    trait = query_db("SELECT * FROM traits WHERE id = ?", [trait_id], one=True)
    return jsonify({"trait": dict(trait), "message": "Trait created."}), 201


@bp.route("/traits/reorder", methods=["POST"])
def reorder_traits():
    payload = require_object(request.get_json(silent=True))
    _apply_reorder("traits", payload.get("ids"))
    return jsonify({"traits": get_traits_payload(), "message": "Trait order updated."})


@bp.route("/traits/<int:trait_id>", methods=["PUT"])
def update_trait(trait_id: int):
    seed_profile_defaults()
    trait = query_db("SELECT * FROM traits WHERE id = ?", [trait_id], one=True)
    if not trait:
        return jsonify({"error": "Trait not found."}), 404

    payload = require_object(request.get_json(silent=True))
    current = dict(trait)
    name = get_required_string({"name": payload.get("name", current["name"])}, "name", max_length=120)
    score = get_optional_int(payload, "score", default=current["score"], minimum=0, maximum=100)
    category = get_optional_string(payload, "category", max_length=80, default=current["category"]) or "general"
    display_order = get_optional_int(
        payload,
        "display_order",
        default=current.get("display_order"),
        minimum=1,
    )

    execute_db(
        """
        UPDATE traits
        SET name = ?, score = ?, category = ?, display_order = ?, last_updated = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (name, score, category, display_order, trait_id),
    )
    _normalize_display_order("traits")
    updated = query_db("SELECT * FROM traits WHERE id = ?", [trait_id], one=True)
    return jsonify({"trait": dict(updated), "message": "Trait updated."})


@bp.route("/traits/<int:trait_id>", methods=["DELETE"])
def delete_trait(trait_id: int):
    trait = query_db("SELECT id FROM traits WHERE id = ?", [trait_id], one=True)
    if not trait:
        return jsonify({"error": "Trait not found."}), 404

    execute_db("DELETE FROM traits WHERE id = ?", [trait_id])
    _normalize_display_order("traits")
    return jsonify({"message": "Trait deleted."})


@bp.route("/beliefs", methods=["GET"])
def get_beliefs():
    return jsonify(get_beliefs_payload())


@bp.route("/beliefs", methods=["POST"])
def create_belief():
    seed_profile_defaults()
    payload = require_object(request.get_json(silent=True))
    title = get_required_string(payload, "title", max_length=160)
    text = get_required_string(payload, "text", max_length=2000)
    display_order = get_optional_int(payload, "display_order", minimum=1) or _next_display_order("beliefs")

    belief_id = execute_db(
        """
        INSERT INTO beliefs (title, text, display_order)
        VALUES (?, ?, ?)
        """,
        (title, text, display_order),
    )
    _normalize_display_order("beliefs")
    belief = query_db("SELECT * FROM beliefs WHERE id = ?", [belief_id], one=True)
    return jsonify({"belief": dict(belief), "message": "Belief created."}), 201


@bp.route("/beliefs/reorder", methods=["POST"])
def reorder_beliefs():
    payload = require_object(request.get_json(silent=True))
    _apply_reorder("beliefs", payload.get("ids"))
    return jsonify({"beliefs": get_beliefs_payload(), "message": "Belief order updated."})


@bp.route("/beliefs/<int:belief_id>", methods=["PUT"])
def update_belief(belief_id: int):
    seed_profile_defaults()
    belief = query_db("SELECT * FROM beliefs WHERE id = ?", [belief_id], one=True)
    if not belief:
        return jsonify({"error": "Belief not found."}), 404

    payload = require_object(request.get_json(silent=True))
    current = dict(belief)
    title = get_required_string({"title": payload.get("title", current["title"])}, "title", max_length=160)
    text = get_required_string({"text": payload.get("text", current["text"])}, "text", max_length=2000)
    display_order = get_optional_int(
        payload,
        "display_order",
        default=current["display_order"],
        minimum=1,
    )

    execute_db(
        """
        UPDATE beliefs
        SET title = ?, text = ?, display_order = ?
        WHERE id = ?
        """,
        (title, text, display_order, belief_id),
    )
    _normalize_display_order("beliefs")
    updated = query_db("SELECT * FROM beliefs WHERE id = ?", [belief_id], one=True)
    return jsonify({"belief": dict(updated), "message": "Belief updated."})


@bp.route("/beliefs/<int:belief_id>", methods=["DELETE"])
def delete_belief(belief_id: int):
    belief = query_db("SELECT id FROM beliefs WHERE id = ?", [belief_id], one=True)
    if not belief:
        return jsonify({"error": "Belief not found."}), 404

    execute_db("DELETE FROM beliefs WHERE id = ?", [belief_id])
    _normalize_display_order("beliefs")
    return jsonify({"message": "Belief deleted."})


@bp.route("/skills", methods=["GET"])
def get_skills():
    return jsonify(get_skills_payload())


@bp.route("/skills", methods=["POST"])
def create_skill():
    seed_profile_defaults()
    payload = require_object(request.get_json(silent=True))
    name = get_required_string(payload, "name", max_length=120)
    category = get_optional_choice(payload, "category", allowed=SKILL_CATEGORIES, default="other") or "other"
    proficiency = get_optional_int(payload, "proficiency", default=50, minimum=0, maximum=100) or 50
    experience_level = (
        get_optional_choice(payload, "experience_level", allowed=EXPERIENCE_LEVELS, default="intermediate")
        or "intermediate"
    )
    notes = get_optional_string(payload, "notes", max_length=2000, default="") or ""
    display_order = get_optional_int(payload, "display_order", minimum=1) or _next_display_order("skills")

    skill_id = execute_db(
        """
        INSERT INTO skills (name, category, proficiency, experience_level, notes, display_order, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (name, category, proficiency, experience_level, notes, display_order),
    )
    _normalize_display_order("skills")
    skill = query_db("SELECT * FROM skills WHERE id = ?", [skill_id], one=True)
    return jsonify({"skill": dict(skill), "message": "Skill created."}), 201


@bp.route("/skills/reorder", methods=["POST"])
def reorder_skills():
    payload = require_object(request.get_json(silent=True))
    _apply_reorder("skills", payload.get("ids"))
    return jsonify({"skills": get_skills_payload(), "message": "Skill order updated."})


@bp.route("/skills/<int:skill_id>", methods=["PUT"])
def update_skill(skill_id: int):
    seed_profile_defaults()
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
    display_order = get_optional_int(payload, "display_order", default=current["display_order"], minimum=1)

    execute_db(
        """
        UPDATE skills
        SET name = ?, category = ?, proficiency = ?, experience_level = ?, notes = ?, display_order = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (name, category, proficiency, experience_level, notes, display_order, skill_id),
    )
    _normalize_display_order("skills")
    updated = query_db("SELECT * FROM skills WHERE id = ?", [skill_id], one=True)
    return jsonify({"skill": dict(updated), "message": "Skill updated."})


@bp.route("/skills/<int:skill_id>", methods=["DELETE"])
def delete_skill(skill_id: int):
    skill = query_db("SELECT id FROM skills WHERE id = ?", [skill_id], one=True)
    if not skill:
        return jsonify({"error": "Skill not found."}), 404

    execute_db("DELETE FROM skills WHERE id = ?", [skill_id])
    _normalize_display_order("skills")
    return jsonify({"message": "Skill deleted."})


@bp.route("/admired-people", methods=["GET"])
def get_admired_people():
    rows = query_db(
        """
        SELECT *
        FROM admired_people
        ORDER BY display_order ASC, id ASC
        """
    )
    return jsonify(rows_to_dicts(rows))


@bp.route("/admired-people", methods=["POST"])
def create_admired_person():
    payload = require_object(request.get_json(silent=True))
    data = _validate_admired_person_payload(payload)
    display_order = get_optional_int(payload, "display_order", minimum=1) or _next_display_order("admired_people")

    person_id = execute_db(
        """
        INSERT INTO admired_people (
            name, role_or_context, why_admired, traits_to_model, reference_url, display_order, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (
            data["name"],
            data["role_or_context"],
            data["why_admired"],
            data["traits_to_model"],
            data["reference_url"],
            display_order,
        ),
    )
    _normalize_display_order("admired_people")
    person = query_db("SELECT * FROM admired_people WHERE id = ?", [person_id], one=True)
    return jsonify({"person": row_to_dict(person), "message": "Admired person saved."}), 201


@bp.route("/admired-people/reorder", methods=["POST"])
def reorder_admired_people():
    payload = require_object(request.get_json(silent=True))
    _apply_reorder("admired_people", payload.get("ids"))
    return jsonify({"people": get_admired_people().get_json(), "message": "Admired people order updated."})


@bp.route("/admired-people/<int:person_id>", methods=["PUT"])
def update_admired_person(person_id: int):
    row = query_db("SELECT * FROM admired_people WHERE id = ?", [person_id], one=True)
    if not row:
        return jsonify({"error": "Admired person not found."}), 404

    current = row_to_dict(row)
    payload = require_object(request.get_json(silent=True))
    merged = {**current, **payload}
    data = _validate_admired_person_payload(merged)
    display_order = get_optional_int(merged, "display_order", default=current["display_order"], minimum=1)

    execute_db(
        """
        UPDATE admired_people
        SET
            name = ?,
            role_or_context = ?,
            why_admired = ?,
            traits_to_model = ?,
            reference_url = ?,
            display_order = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
            data["name"],
            data["role_or_context"],
            data["why_admired"],
            data["traits_to_model"],
            data["reference_url"],
            display_order,
            person_id,
        ),
    )
    _normalize_display_order("admired_people")
    updated = query_db("SELECT * FROM admired_people WHERE id = ?", [person_id], one=True)
    return jsonify({"person": row_to_dict(updated), "message": "Admired person updated."})


@bp.route("/admired-people/<int:person_id>", methods=["DELETE"])
def delete_admired_person(person_id: int):
    row = query_db("SELECT id FROM admired_people WHERE id = ?", [person_id], one=True)
    if not row:
        return jsonify({"error": "Admired person not found."}), 404
    execute_db("DELETE FROM admired_people WHERE id = ?", [person_id])
    _normalize_display_order("admired_people")
    return jsonify({"message": "Admired person deleted."})


def _validate_admired_person_payload(payload: dict) -> dict[str, str]:
    return {
        "name": get_required_string(payload, "name", max_length=140),
        "role_or_context": get_optional_string(payload, "role_or_context", max_length=160, default="") or "",
        "why_admired": get_required_string(payload, "why_admired", max_length=3000),
        "traits_to_model": get_optional_string(payload, "traits_to_model", max_length=1000, default="") or "",
        "reference_url": _optional_url(payload, "reference_url"),
    }


def _optional_url(payload: dict, field: str) -> str:
    raw_value = get_optional_string(payload, field, max_length=1000, default="") or ""
    if not raw_value:
        return ""
    value = raw_value if "://" in raw_value else f"https://{raw_value}"
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValidationError(f"{field.replace('_', ' ').title()} must be a valid website link.", field)
    return value


def _next_display_order(table_name: str) -> int:
    row = query_db(f"SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM {table_name}", one=True)
    return int(row["next_order"] or 1)


def _apply_reorder(table_name: str, ids: object) -> None:
    if not isinstance(ids, list) or not ids:
        raise ValidationError("Ids must be a non-empty list.", "ids")

    normalized_ids: list[int] = []
    for item in ids:
        try:
            parsed = int(item)
        except (TypeError, ValueError) as exc:
            raise ValidationError("Ids must contain only integers.", "ids") from exc
        normalized_ids.append(parsed)

    if len(set(normalized_ids)) != len(normalized_ids):
        raise ValidationError("Ids must be unique.", "ids")

    existing_ids = {int(row["id"]) for row in query_db(f"SELECT id FROM {table_name}")}
    if set(normalized_ids) != existing_ids:
        raise ValidationError("Ids must include every existing record exactly once.", "ids")

    for index, item_id in enumerate(normalized_ids, start=1):
        execute_db(f"UPDATE {table_name} SET display_order = ? WHERE id = ?", (index, item_id))


def _normalize_display_order(table_name: str) -> None:
    rows = query_db(
        f"""
        SELECT id, display_order
        FROM {table_name}
        ORDER BY COALESCE(display_order, 0) ASC, id ASC
        """
    )
    for index, row in enumerate(rows, start=1):
        if int(row["display_order"] or 0) == index:
            continue
        execute_db(f"UPDATE {table_name} SET display_order = ? WHERE id = ?", (index, row["id"]))
