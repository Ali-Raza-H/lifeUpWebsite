from __future__ import annotations

from urllib.parse import urlparse

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from utils import (
    ValidationError,
    get_optional_choice,
    get_optional_date,
    get_optional_int,
    get_optional_string,
    get_required_string,
    require_object,
    row_to_dict,
    rows_to_dicts,
)

bp = Blueprint("life_api", __name__, url_prefix="/api/life")

FINANCE_TYPES = {"income", "expense", "saving", "subscription"}
CONTACT_PRIORITIES = {"low", "normal", "high"}
REVIEW_PERIODS = {"weekly", "monthly"}
ATTACHMENT_ENTITIES = {"general", "note", "project", "goal", "journal", "task"}
MEAL_TYPES = {"breakfast", "lunch", "dinner", "snack"}


def _optional_float(payload: dict, field: str, *, minimum: float | None = None) -> float | None:
    value = payload.get(field)
    if value in (None, ""):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{field.replace('_', ' ').title()} must be a number.", field) from exc
    if minimum is not None and parsed < minimum:
        raise ValidationError(f"{field.replace('_', ' ').title()} must be at least {minimum}.", field)
    return parsed


def _required_float(payload: dict, field: str, *, minimum: float | None = None) -> float:
    value = _optional_float(payload, field, minimum=minimum)
    if value is None:
        raise ValidationError(f"{field.replace('_', ' ').title()} is required.", field)
    return value


def _normalize_url(value: str) -> str:
    clean_value = value.strip()
    if not clean_value:
        raise ValidationError("Url is required.", "url")
    if "://" not in clean_value:
        clean_value = f"https://{clean_value}"
    parsed = urlparse(clean_value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValidationError("Url must be a valid website link.", "url")
    return clean_value


@bp.route("/summary", methods=["GET"])
def get_summary():
    latest_health = query_db("SELECT * FROM health_logs ORDER BY log_date DESC, id DESC LIMIT 1", one=True)
    finance = query_db(
        """
        SELECT
            SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
            SUM(CASE WHEN type IN ('expense', 'subscription') THEN amount ELSE 0 END) AS spending,
            SUM(CASE WHEN type = 'saving' THEN amount ELSE 0 END) AS savings,
            COUNT(*) AS entry_count
        FROM finance_entries
        """,
        one=True,
    )
    contacts_due = query_db(
        """
        SELECT COUNT(*) AS count
        FROM contacts
        WHERE next_follow_up IS NOT NULL AND next_follow_up <= DATE('now')
        """,
        one=True,
    )
    today_diet = query_db(
        """
        SELECT
            COUNT(*) AS entry_count,
            COALESCE(SUM(calories), 0) AS calories,
            COALESCE(SUM(protein_g), 0) AS protein_g,
            COALESCE(SUM(carbs_g), 0) AS carbs_g,
            COALESCE(SUM(fat_g), 0) AS fat_g
        FROM diet_entries
        WHERE entry_date = DATE('now')
        """,
        one=True,
    )
    return jsonify(
        {
            "latest_health": row_to_dict(latest_health),
            "finance": row_to_dict(finance),
            "contacts_due": contacts_due["count"] if contacts_due else 0,
            "today_diet": row_to_dict(today_diet),
        }
    )


@bp.route("/health", methods=["GET"])
def get_health_logs():
    rows = query_db("SELECT * FROM health_logs ORDER BY log_date DESC, id DESC LIMIT 60")
    return jsonify(rows_to_dicts(rows))


@bp.route("/health", methods=["POST"])
def create_health_log():
    payload = require_object(request.get_json(silent=True))
    log_date = get_optional_date(payload, "log_date")
    if not log_date:
        raise ValidationError("Log date is required.", "log_date")
    sleep_hours = _optional_float(payload, "sleep_hours", minimum=0)
    weight_kg = _optional_float(payload, "weight_kg", minimum=0)
    exercise_minutes = get_optional_int(payload, "exercise_minutes", minimum=0)
    energy_score = get_optional_int(payload, "energy_score", minimum=1, maximum=10)
    symptoms = get_optional_string(payload, "symptoms", max_length=1000, default="") or ""
    notes = get_optional_string(payload, "notes", max_length=2000, default="") or ""

    log_id = execute_db(
        """
        INSERT INTO health_logs (log_date, sleep_hours, weight_kg, exercise_minutes, energy_score, symptoms, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (log_date, sleep_hours, weight_kg, exercise_minutes, energy_score, symptoms, notes),
    )
    log = query_db("SELECT * FROM health_logs WHERE id = ?", [log_id], one=True)
    return jsonify({"log": row_to_dict(log), "message": "Health log saved."}), 201


@bp.route("/health/<int:log_id>", methods=["DELETE"])
def delete_health_log(log_id: int):
    row = query_db("SELECT id FROM health_logs WHERE id = ?", [log_id], one=True)
    if not row:
        return jsonify({"error": "Health log not found."}), 404
    execute_db("DELETE FROM health_logs WHERE id = ?", [log_id])
    return jsonify({"message": "Health log deleted."})


@bp.route("/diet/presets", methods=["GET"])
def get_food_presets():
    rows = query_db(
        """
        SELECT *
        FROM food_presets
        ORDER BY display_order ASC, name COLLATE NOCASE ASC, id ASC
        """
    )
    return jsonify(rows_to_dicts(rows))


@bp.route("/diet", methods=["GET"])
def get_diet_entries():
    rows = query_db(
        """
        SELECT *
        FROM diet_entries
        ORDER BY
            entry_date DESC,
            CASE meal_type
                WHEN 'breakfast' THEN 0
                WHEN 'lunch' THEN 1
                WHEN 'dinner' THEN 2
                ELSE 3
            END,
            id DESC
        LIMIT 120
        """
    )
    return jsonify(rows_to_dicts(rows))


@bp.route("/diet", methods=["POST"])
def create_diet_entry():
    payload = require_object(request.get_json(silent=True))
    entry_date = get_optional_date(payload, "entry_date")
    if not entry_date:
        raise ValidationError("Entry date is required.", "entry_date")

    preset_id = get_optional_int(payload, "preset_id", minimum=1)
    if preset_id is None:
        raise ValidationError("Preset food is required.", "preset_id")

    meal_type = get_optional_choice(payload, "meal_type", allowed=MEAL_TYPES, default="snack") or "snack"
    servings = _required_float(payload, "servings", minimum=0.1)
    notes = get_optional_string(payload, "notes", max_length=1000, default="") or ""

    preset = query_db("SELECT * FROM food_presets WHERE id = ?", [preset_id], one=True)
    if not preset:
        return jsonify({"error": "Food preset not found."}), 404

    calories = round(float(preset["calories"] or 0) * servings, 2)
    protein_g = round(float(preset["protein_g"] or 0) * servings, 2)
    carbs_g = round(float(preset["carbs_g"] or 0) * servings, 2)
    fat_g = round(float(preset["fat_g"] or 0) * servings, 2)

    entry_id = execute_db(
        """
        INSERT INTO diet_entries (
            entry_date, preset_id, food_name, category, serving_label, meal_type, servings,
            calories, protein_g, carbs_g, fat_g, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            entry_date,
            preset_id,
            preset["name"],
            preset["category"] if "category" in preset.keys() else "",
            preset["serving_label"],
            meal_type,
            servings,
            calories,
            protein_g,
            carbs_g,
            fat_g,
            notes,
        ),
    )
    entry = query_db("SELECT * FROM diet_entries WHERE id = ?", [entry_id], one=True)
    return jsonify({"entry": row_to_dict(entry), "message": "Diet entry saved."}), 201


@bp.route("/diet/<int:entry_id>", methods=["DELETE"])
def delete_diet_entry(entry_id: int):
    row = query_db("SELECT id FROM diet_entries WHERE id = ?", [entry_id], one=True)
    if not row:
        return jsonify({"error": "Diet entry not found."}), 404
    execute_db("DELETE FROM diet_entries WHERE id = ?", [entry_id])
    return jsonify({"message": "Diet entry deleted."})


@bp.route("/finance", methods=["GET"])
def get_finance_entries():
    rows = query_db("SELECT * FROM finance_entries ORDER BY entry_date DESC, id DESC LIMIT 120")
    return jsonify(rows_to_dicts(rows))


@bp.route("/finance", methods=["POST"])
def create_finance_entry():
    payload = require_object(request.get_json(silent=True))
    entry_date = get_optional_date(payload, "entry_date")
    if not entry_date:
        raise ValidationError("Entry date is required.", "entry_date")
    entry_type = get_optional_choice(payload, "type", allowed=FINANCE_TYPES, default="expense") or "expense"
    category = get_optional_string(payload, "category", max_length=80, default="") or ""
    amount = _required_float(payload, "amount", minimum=0)
    description = get_optional_string(payload, "description", max_length=500, default="") or ""
    is_recurring = 1 if payload.get("is_recurring") else 0

    entry_id = execute_db(
        """
        INSERT INTO finance_entries (entry_date, type, category, amount, description, is_recurring)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (entry_date, entry_type, category, amount, description, is_recurring),
    )
    entry = query_db("SELECT * FROM finance_entries WHERE id = ?", [entry_id], one=True)
    return jsonify({"entry": row_to_dict(entry), "message": "Finance entry saved."}), 201


@bp.route("/finance/<int:entry_id>", methods=["DELETE"])
def delete_finance_entry(entry_id: int):
    row = query_db("SELECT id FROM finance_entries WHERE id = ?", [entry_id], one=True)
    if not row:
        return jsonify({"error": "Finance entry not found."}), 404
    execute_db("DELETE FROM finance_entries WHERE id = ?", [entry_id])
    return jsonify({"message": "Finance entry deleted."})


@bp.route("/contacts", methods=["GET"])
def get_contacts():
    rows = query_db(
        """
        SELECT *
        FROM contacts
        ORDER BY
            CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
            COALESCE(next_follow_up, '9999-12-31') ASC,
            name ASC
        """
    )
    return jsonify(rows_to_dicts(rows))


@bp.route("/contacts", methods=["POST"])
def create_contact():
    payload = require_object(request.get_json(silent=True))
    name = get_required_string(payload, "name", max_length=120)
    relation = get_optional_string(payload, "relation", max_length=80, default="") or ""
    priority = get_optional_choice(payload, "priority", allowed=CONTACT_PRIORITIES, default="normal") or "normal"
    last_contacted = get_optional_date(payload, "last_contacted")
    next_follow_up = get_optional_date(payload, "next_follow_up")
    notes = get_optional_string(payload, "notes", max_length=2000, default="") or ""

    contact_id = execute_db(
        """
        INSERT INTO contacts (name, relation, priority, last_contacted, next_follow_up, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (name, relation, priority, last_contacted, next_follow_up, notes),
    )
    contact = query_db("SELECT * FROM contacts WHERE id = ?", [contact_id], one=True)
    return jsonify({"contact": row_to_dict(contact), "message": "Contact saved."}), 201


@bp.route("/contacts/<int:contact_id>", methods=["PUT"])
def update_contact(contact_id: int):
    contact = query_db("SELECT * FROM contacts WHERE id = ?", [contact_id], one=True)
    if not contact:
        return jsonify({"error": "Contact not found."}), 404
    current = row_to_dict(contact)
    payload = require_object(request.get_json(silent=True))

    name = get_optional_string(payload, "name", max_length=120, default=current["name"]) or current["name"]
    relation = get_optional_string(payload, "relation", max_length=80, default=current["relation"] or "") or ""
    priority = get_optional_choice(payload, "priority", allowed=CONTACT_PRIORITIES, default=current["priority"]) or current["priority"]
    last_contacted = get_optional_date(payload, "last_contacted") if "last_contacted" in payload else current["last_contacted"]
    next_follow_up = get_optional_date(payload, "next_follow_up") if "next_follow_up" in payload else current["next_follow_up"]
    notes = get_optional_string(payload, "notes", max_length=2000, default=current["notes"] or "") or ""

    execute_db(
        """
        UPDATE contacts
        SET name = ?, relation = ?, priority = ?, last_contacted = ?, next_follow_up = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (name, relation, priority, last_contacted, next_follow_up, notes, contact_id),
    )
    updated = query_db("SELECT * FROM contacts WHERE id = ?", [contact_id], one=True)
    return jsonify({"contact": row_to_dict(updated), "message": "Contact updated."})


@bp.route("/contacts/<int:contact_id>", methods=["DELETE"])
def delete_contact(contact_id: int):
    row = query_db("SELECT id FROM contacts WHERE id = ?", [contact_id], one=True)
    if not row:
        return jsonify({"error": "Contact not found."}), 404
    execute_db("DELETE FROM contacts WHERE id = ?", [contact_id])
    return jsonify({"message": "Contact deleted."})


@bp.route("/reviews", methods=["GET"])
def get_reviews():
    rows = query_db("SELECT * FROM life_reviews ORDER BY period_start DESC, id DESC LIMIT 40")
    return jsonify(rows_to_dicts(rows))


@bp.route("/reviews", methods=["POST"])
def upsert_review():
    payload = require_object(request.get_json(silent=True))
    period_type = get_optional_choice(payload, "period_type", allowed=REVIEW_PERIODS, default="weekly") or "weekly"
    period_start = get_optional_date(payload, "period_start")
    if not period_start:
        raise ValidationError("Period start is required.", "period_start")
    score = get_optional_int(payload, "score", minimum=1, maximum=10)
    wins = get_optional_string(payload, "wins", max_length=3000, default="") or ""
    challenges = get_optional_string(payload, "challenges", max_length=3000, default="") or ""
    next_focus = get_optional_string(payload, "next_focus", max_length=3000, default="") or ""

    review_id = execute_db(
        """
        INSERT INTO life_reviews (period_type, period_start, score, wins, challenges, next_focus, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(period_type, period_start) DO UPDATE SET
            score = excluded.score,
            wins = excluded.wins,
            challenges = excluded.challenges,
            next_focus = excluded.next_focus,
            updated_at = CURRENT_TIMESTAMP
        """,
        (period_type, period_start, score, wins, challenges, next_focus),
    )
    if review_id == 0:
        row = query_db(
            "SELECT * FROM life_reviews WHERE period_type = ? AND period_start = ?",
            [period_type, period_start],
            one=True,
        )
    else:
        row = query_db("SELECT * FROM life_reviews WHERE id = ?", [review_id], one=True)
    return jsonify({"review": row_to_dict(row), "message": "Review saved."}), 201


@bp.route("/reviews/<int:review_id>", methods=["DELETE"])
def delete_review(review_id: int):
    row = query_db("SELECT id FROM life_reviews WHERE id = ?", [review_id], one=True)
    if not row:
        return jsonify({"error": "Review not found."}), 404
    execute_db("DELETE FROM life_reviews WHERE id = ?", [review_id])
    return jsonify({"message": "Review deleted."})


@bp.route("/attachments", methods=["GET"])
def get_attachments():
    rows = query_db(
        """
        SELECT *
        FROM attachments
        ORDER BY created_at DESC, id DESC
        LIMIT 120
        """
    )
    return jsonify(rows_to_dicts(rows))


@bp.route("/attachments", methods=["POST"])
def create_attachment():
    payload = require_object(request.get_json(silent=True))
    entity_type = get_optional_choice(payload, "entity_type", allowed=ATTACHMENT_ENTITIES, default="general") or "general"
    entity_id = get_optional_int(payload, "entity_id", minimum=1)
    title = get_required_string(payload, "title", max_length=140)
    raw_url = get_required_string(payload, "url", max_length=1000)
    url = _normalize_url(raw_url)
    notes = get_optional_string(payload, "notes", max_length=1000, default="") or ""

    attachment_id = execute_db(
        """
        INSERT INTO attachments (entity_type, entity_id, title, url, notes)
        VALUES (?, ?, ?, ?, ?)
        """,
        (entity_type, entity_id, title, url, notes),
    )
    attachment = query_db("SELECT * FROM attachments WHERE id = ?", [attachment_id], one=True)
    return jsonify({"attachment": row_to_dict(attachment), "message": "Attachment saved."}), 201


@bp.route("/attachments/<int:attachment_id>", methods=["DELETE"])
def delete_attachment(attachment_id: int):
    row = query_db("SELECT id FROM attachments WHERE id = ?", [attachment_id], one=True)
    if not row:
        return jsonify({"error": "Attachment not found."}), 404
    execute_db("DELETE FROM attachments WHERE id = ?", [attachment_id])
    return jsonify({"message": "Attachment deleted."})
