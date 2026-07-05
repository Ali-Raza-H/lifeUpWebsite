from __future__ import annotations

from urllib.parse import urlparse

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from utils import (
    ValidationError,
    get_optional_bool,
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


def _optional_bool_flag(payload: dict, field: str, *, default: bool = False) -> bool:
    value = payload.get(field, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in {0, 1}:
        return bool(value)
    raise ValidationError(f"{field.replace('_', ' ').title()} must be true or false.", field)


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


def _attachment_query(filters: list[str], params: list[object]) -> list[dict]:
    query = """
        SELECT
            a.*,
            CASE
                WHEN a.entity_type = 'project' THEN p.name
                WHEN a.entity_type = 'goal' THEN g.title
                WHEN a.entity_type = 'task' THEN t.title
                WHEN a.entity_type = 'note' THEN n.title
                WHEN a.entity_type IN ('journal', 'journal_entry') THEN COALESCE(j.title, j.content)
                ELSE NULL
            END AS entity_title
        FROM attachments a
        LEFT JOIN projects p ON a.entity_type = 'project' AND p.id = a.entity_id
        LEFT JOIN goals g ON a.entity_type = 'goal' AND g.id = a.entity_id
        LEFT JOIN tasks t ON a.entity_type = 'task' AND t.id = a.entity_id
        LEFT JOIN notes n ON a.entity_type = 'note' AND n.id = a.entity_id
        LEFT JOIN journal_entries j ON a.entity_type IN ('journal', 'journal_entry') AND j.id = a.entity_id
    """
    if filters:
        query += f" WHERE {' AND '.join(filters)}"
    query += " ORDER BY a.is_favorite DESC, a.created_at DESC, a.id DESC LIMIT 200"
    return rows_to_dicts(query_db(query, params))


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
        ORDER BY is_favorite DESC, display_order ASC, name COLLATE NOCASE ASC, id ASC
        """
    )
    return jsonify(rows_to_dicts(rows))


@bp.route("/diet/presets", methods=["POST"])
def create_food_preset():
    payload = require_object(request.get_json(silent=True))
    data = _validate_food_preset_payload(payload)
    display_order = get_optional_int(payload, "display_order", minimum=1) or _next_food_preset_order()

    preset_id = execute_db(
        """
        INSERT INTO food_presets (
            name, category, serving_label, calories, protein_g, carbs_g, fat_g, is_favorite, display_order, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (
            data["name"],
            data["category"],
            data["serving_label"],
            data["calories"],
            data["protein_g"],
            data["carbs_g"],
            data["fat_g"],
            data["is_favorite"],
            display_order,
        ),
    )
    _normalize_food_preset_order()
    preset = query_db("SELECT * FROM food_presets WHERE id = ?", [preset_id], one=True)
    return jsonify({"preset": row_to_dict(preset), "message": "Food preset saved."}), 201


@bp.route("/diet/presets/reorder", methods=["POST"])
def reorder_food_presets():
    payload = require_object(request.get_json(silent=True))
    ids = payload.get("ids")
    if not isinstance(ids, list) or not ids:
        raise ValidationError("Ids must be a non-empty list.", "ids")

    normalized_ids: list[int] = []
    for item in ids:
        try:
            normalized_ids.append(int(item))
        except (TypeError, ValueError) as exc:
            raise ValidationError("Ids must contain only integers.", "ids") from exc

    if len(set(normalized_ids)) != len(normalized_ids):
        raise ValidationError("Ids must be unique.", "ids")

    existing_ids = {int(row["id"]) for row in query_db("SELECT id FROM food_presets")}
    if set(normalized_ids) != existing_ids:
        raise ValidationError("Ids must include every existing preset exactly once.", "ids")

    for index, preset_id in enumerate(normalized_ids, start=1):
        execute_db("UPDATE food_presets SET display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (index, preset_id))
    return jsonify({"presets": rows_to_dicts(query_db("SELECT * FROM food_presets ORDER BY display_order, name, id")), "message": "Food order updated."})


@bp.route("/diet/presets/<int:preset_id>", methods=["PUT"])
def update_food_preset(preset_id: int):
    row = query_db("SELECT * FROM food_presets WHERE id = ?", [preset_id], one=True)
    if not row:
        return jsonify({"error": "Food preset not found."}), 404

    current = row_to_dict(row)
    payload = require_object(request.get_json(silent=True))
    merged = {**current, **payload}
    data = _validate_food_preset_payload(merged)
    display_order = get_optional_int(merged, "display_order", default=current["display_order"], minimum=1)

    execute_db(
        """
        UPDATE food_presets
        SET
            name = ?,
            category = ?,
            serving_label = ?,
            calories = ?,
            protein_g = ?,
            carbs_g = ?,
            fat_g = ?,
            is_favorite = ?,
            display_order = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
            data["name"],
            data["category"],
            data["serving_label"],
            data["calories"],
            data["protein_g"],
            data["carbs_g"],
            data["fat_g"],
            data["is_favorite"],
            display_order,
            preset_id,
        ),
    )
    _normalize_food_preset_order()
    preset = query_db("SELECT * FROM food_presets WHERE id = ?", [preset_id], one=True)
    return jsonify({"preset": row_to_dict(preset), "message": "Food preset updated."})


@bp.route("/diet/presets/<int:preset_id>", methods=["DELETE"])
def delete_food_preset(preset_id: int):
    row = query_db("SELECT id FROM food_presets WHERE id = ?", [preset_id], one=True)
    if not row:
        return jsonify({"error": "Food preset not found."}), 404

    usage = query_db("SELECT COUNT(*) AS count FROM diet_entries WHERE preset_id = ?", [preset_id], one=True)
    if int(usage["count"] or 0) > 0:
        return jsonify({"error": "Food preset is used by diet entries and cannot be deleted."}), 409

    execute_db("DELETE FROM food_presets WHERE id = ?", [preset_id])
    _normalize_food_preset_order()
    return jsonify({"message": "Food preset deleted."})


@bp.route("/diet/targets", methods=["GET"])
def get_diet_targets():
    row = query_db("SELECT * FROM diet_targets WHERE id = 1", one=True)
    if not row:
        return jsonify({"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0})
    return jsonify(row_to_dict(row))


@bp.route("/diet/targets", methods=["PUT"])
def update_diet_targets():
    payload = require_object(request.get_json(silent=True))
    calories = _optional_float(payload, "calories", minimum=0) or 0
    protein_g = _optional_float(payload, "protein_g", minimum=0) or 0
    carbs_g = _optional_float(payload, "carbs_g", minimum=0) or 0
    fat_g = _optional_float(payload, "fat_g", minimum=0) or 0

    execute_db(
        """
        INSERT INTO diet_targets (id, calories, protein_g, carbs_g, fat_g, updated_at)
        VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            calories = excluded.calories,
            protein_g = excluded.protein_g,
            carbs_g = excluded.carbs_g,
            fat_g = excluded.fat_g,
            updated_at = CURRENT_TIMESTAMP
        """,
        (calories, protein_g, carbs_g, fat_g),
    )
    row = query_db("SELECT * FROM diet_targets WHERE id = 1", one=True)
    return jsonify({"targets": row_to_dict(row), "message": "Diet targets updated."})


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


@bp.route("/gym/routines", methods=["GET"])
def get_gym_routines():
    rows = rows_to_dicts(
        query_db(
            """
            SELECT *
            FROM gym_routines
            ORDER BY is_active DESC, updated_at DESC, id DESC
            """
        )
    )
    for routine in rows:
        routine["exercises"] = rows_to_dicts(
            query_db(
                """
                SELECT *
                FROM gym_exercises
                WHERE routine_id = ?
                ORDER BY display_order ASC, id ASC
                """,
                [routine["id"]],
            )
        )
    return jsonify(rows)


@bp.route("/gym/routines", methods=["POST"])
def create_gym_routine():
    payload = require_object(request.get_json(silent=True))
    name = get_required_string(payload, "name", max_length=140)
    goal = get_optional_string(payload, "goal", max_length=1000, default="") or ""
    is_active = 1 if get_optional_bool(payload, "is_active", default=True) else 0
    routine_id = execute_db(
        """
        INSERT INTO gym_routines (name, goal, is_active, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (name, goal, is_active),
    )
    routine = query_db("SELECT * FROM gym_routines WHERE id = ?", [routine_id], one=True)
    return jsonify({"routine": row_to_dict(routine), "message": "Gym routine saved."}), 201


@bp.route("/gym/routines/<int:routine_id>", methods=["PUT"])
def update_gym_routine(routine_id: int):
    row = query_db("SELECT * FROM gym_routines WHERE id = ?", [routine_id], one=True)
    if not row:
        return jsonify({"error": "Gym routine not found."}), 404
    current = row_to_dict(row)
    payload = require_object(request.get_json(silent=True))
    name = get_optional_string(payload, "name", max_length=140, default=current["name"]) or current["name"]
    goal = get_optional_string(payload, "goal", max_length=1000, default=current.get("goal") or "") or ""
    is_active = current.get("is_active", 1)
    if "is_active" in payload:
        is_active = 1 if get_optional_bool(payload, "is_active", default=bool(is_active)) else 0
    execute_db(
        """
        UPDATE gym_routines
        SET name = ?, goal = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (name, goal, is_active, routine_id),
    )
    updated = query_db("SELECT * FROM gym_routines WHERE id = ?", [routine_id], one=True)
    return jsonify({"routine": row_to_dict(updated), "message": "Gym routine updated."})


@bp.route("/gym/routines/<int:routine_id>", methods=["DELETE"])
def delete_gym_routine(routine_id: int):
    row = query_db("SELECT id FROM gym_routines WHERE id = ?", [routine_id], one=True)
    if not row:
        return jsonify({"error": "Gym routine not found."}), 404
    execute_db("DELETE FROM gym_routines WHERE id = ?", [routine_id])
    return jsonify({"message": "Gym routine deleted."})


@bp.route("/gym/exercises", methods=["POST"])
def create_gym_exercise():
    payload = require_object(request.get_json(silent=True))
    data = _validate_gym_exercise_payload(payload)
    exercise_id = execute_db(
        """
        INSERT INTO gym_exercises (
            routine_id, name, day_of_week, machine, muscle_group, sets, reps, target_weight, notes, display_order, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (
            data["routine_id"],
            data["name"],
            data["day_of_week"],
            data["machine"],
            data["muscle_group"],
            data["sets"],
            data["reps"],
            data["target_weight"],
            data["notes"],
            data["display_order"],
        ),
    )
    exercise = query_db("SELECT * FROM gym_exercises WHERE id = ?", [exercise_id], one=True)
    return jsonify({"exercise": row_to_dict(exercise), "message": "Gym exercise saved."}), 201


@bp.route("/gym/exercises/<int:exercise_id>", methods=["PUT"])
def update_gym_exercise(exercise_id: int):
    row = query_db("SELECT * FROM gym_exercises WHERE id = ?", [exercise_id], one=True)
    if not row:
        return jsonify({"error": "Gym exercise not found."}), 404
    current = row_to_dict(row)
    payload = require_object(request.get_json(silent=True))
    data = _validate_gym_exercise_payload({**current, **payload})
    execute_db(
        """
        UPDATE gym_exercises
        SET
            routine_id = ?,
            name = ?,
            day_of_week = ?,
            machine = ?,
            muscle_group = ?,
            sets = ?,
            reps = ?,
            target_weight = ?,
            notes = ?,
            display_order = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
            data["routine_id"],
            data["name"],
            data["day_of_week"],
            data["machine"],
            data["muscle_group"],
            data["sets"],
            data["reps"],
            data["target_weight"],
            data["notes"],
            data["display_order"],
            exercise_id,
        ),
    )
    updated = query_db("SELECT * FROM gym_exercises WHERE id = ?", [exercise_id], one=True)
    return jsonify({"exercise": row_to_dict(updated), "message": "Gym exercise updated."})


@bp.route("/gym/exercises/<int:exercise_id>", methods=["DELETE"])
def delete_gym_exercise(exercise_id: int):
    row = query_db("SELECT id FROM gym_exercises WHERE id = ?", [exercise_id], one=True)
    if not row:
        return jsonify({"error": "Gym exercise not found."}), 404
    execute_db("DELETE FROM gym_exercises WHERE id = ?", [exercise_id])
    return jsonify({"message": "Gym exercise deleted."})


@bp.route("/gym/logs", methods=["GET"])
def get_gym_logs():
    rows = query_db(
        """
        SELECT l.*, e.name AS exercise_name, r.name AS routine_name
        FROM gym_workout_logs l
        JOIN gym_exercises e ON e.id = l.exercise_id
        JOIN gym_routines r ON r.id = e.routine_id
        ORDER BY l.log_date DESC, l.id DESC
        LIMIT 120
        """
    )
    return jsonify(rows_to_dicts(rows))


@bp.route("/gym/logs", methods=["POST"])
def create_gym_log():
    payload = require_object(request.get_json(silent=True))
    exercise_id = get_optional_int(payload, "exercise_id", minimum=1)
    if exercise_id is None:
        raise ValidationError("Exercise is required.", "exercise_id")
    if not query_db("SELECT id FROM gym_exercises WHERE id = ?", [exercise_id], one=True):
        return jsonify({"error": "Gym exercise not found."}), 404
    log_date = get_optional_date(payload, "log_date")
    if not log_date:
        raise ValidationError("Log date is required.", "log_date")
    sets_completed = get_optional_int(payload, "sets_completed", minimum=0)
    reps_completed = get_optional_string(payload, "reps_completed", max_length=80, default="") or ""
    weight_used = _optional_float(payload, "weight_used", minimum=0)
    notes = get_optional_string(payload, "notes", max_length=1000, default="") or ""
    log_id = execute_db(
        """
        INSERT INTO gym_workout_logs (exercise_id, log_date, sets_completed, reps_completed, weight_used, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (exercise_id, log_date, sets_completed, reps_completed, weight_used, notes),
    )
    row = query_db("SELECT * FROM gym_workout_logs WHERE id = ?", [log_id], one=True)
    return jsonify({"log": row_to_dict(row), "message": "Workout log saved."}), 201


@bp.route("/gym/logs/<int:log_id>", methods=["DELETE"])
def delete_gym_log(log_id: int):
    row = query_db("SELECT id FROM gym_workout_logs WHERE id = ?", [log_id], one=True)
    if not row:
        return jsonify({"error": "Workout log not found."}), 404
    execute_db("DELETE FROM gym_workout_logs WHERE id = ?", [log_id])
    return jsonify({"message": "Workout log deleted."})


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
    filters: list[str] = []
    params: list[object] = []

    entity_type = request.args.get("entity_type")
    if entity_type:
        entity_type = get_optional_choice({"entity_type": entity_type}, "entity_type", allowed=ATTACHMENT_ENTITIES)
        filters.append("a.entity_type = ?")
        params.append(entity_type)

    entity_id = request.args.get("entity_id", type=int)
    if entity_id is not None:
        filters.append("a.entity_id = ?")
        params.append(entity_id)

    favorites = request.args.get("favorites")
    if favorites == "1":
        filters.append("a.is_favorite = 1")

    query_text = request.args.get("q", "").strip().lower()
    if query_text:
        filters.append(
            "LOWER(a.title || ' ' || COALESCE(a.notes, '') || ' ' || COALESCE(a.url, '') || ' ' || COALESCE(p.name, '') || ' ' || COALESCE(g.title, '') || ' ' || COALESCE(t.title, '') || ' ' || COALESCE(n.title, '') || ' ' || COALESCE(j.title, '')) LIKE ?"
        )
        params.append(f"%{query_text}%")

    return jsonify(_attachment_query(filters, params))


@bp.route("/attachments", methods=["POST"])
def create_attachment():
    payload = require_object(request.get_json(silent=True))
    entity_type = get_optional_choice(payload, "entity_type", allowed=ATTACHMENT_ENTITIES, default="general") or "general"
    entity_id = get_optional_int(payload, "entity_id", minimum=1)
    title = get_required_string(payload, "title", max_length=140)
    raw_url = get_required_string(payload, "url", max_length=1000)
    url = _normalize_url(raw_url)
    notes = get_optional_string(payload, "notes", max_length=1000, default="") or ""
    is_favorite = 1 if get_optional_bool(payload, "is_favorite", default=False) else 0

    attachment_id = execute_db(
        """
        INSERT INTO attachments (entity_type, entity_id, title, url, notes, is_favorite)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (entity_type, entity_id, title, url, notes, is_favorite),
    )
    attachment = _attachment_query(["a.id = ?"], [attachment_id])[0]
    return jsonify({"attachment": attachment, "message": "Attachment saved."}), 201


@bp.route("/attachments/<int:attachment_id>", methods=["PUT"])
def update_attachment(attachment_id: int):
    row = query_db("SELECT * FROM attachments WHERE id = ?", [attachment_id], one=True)
    if not row:
        return jsonify({"error": "Attachment not found."}), 404

    current = row_to_dict(row)
    payload = require_object(request.get_json(silent=True))
    entity_type = (
        get_optional_choice(payload, "entity_type", allowed=ATTACHMENT_ENTITIES, default=current["entity_type"])
        or current["entity_type"]
    )
    entity_id = get_optional_int(payload, "entity_id", minimum=1) if "entity_id" in payload else current.get("entity_id")
    title = get_optional_string(payload, "title", max_length=140, default=current["title"]) or current["title"]
    raw_url = get_optional_string(payload, "url", max_length=1000, default=current["url"]) or current["url"]
    url = _normalize_url(raw_url)
    notes = get_optional_string(payload, "notes", max_length=1000, default=current.get("notes") or "") or ""
    is_favorite = current.get("is_favorite", 0)
    if "is_favorite" in payload:
        is_favorite = 1 if get_optional_bool(payload, "is_favorite", default=bool(current.get("is_favorite"))) else 0

    execute_db(
        """
        UPDATE attachments
        SET entity_type = ?, entity_id = ?, title = ?, url = ?, notes = ?, is_favorite = ?
        WHERE id = ?
        """,
        (entity_type, entity_id, title, url, notes, is_favorite, attachment_id),
    )
    attachment = _attachment_query(["a.id = ?"], [attachment_id])[0]
    return jsonify({"attachment": attachment, "message": "Attachment updated."})


@bp.route("/attachments/<int:attachment_id>", methods=["DELETE"])
def delete_attachment(attachment_id: int):
    row = query_db("SELECT id FROM attachments WHERE id = ?", [attachment_id], one=True)
    if not row:
        return jsonify({"error": "Attachment not found."}), 404
    execute_db("DELETE FROM attachments WHERE id = ?", [attachment_id])
    return jsonify({"message": "Attachment deleted."})


def _validate_food_preset_payload(payload: dict) -> dict[str, object]:
    return {
        "name": get_required_string(payload, "name", max_length=140),
        "category": get_optional_string(payload, "category", max_length=100, default="Uncategorized") or "Uncategorized",
        "serving_label": get_required_string(payload, "serving_label", max_length=120),
        "calories": _required_float(payload, "calories", minimum=0),
        "protein_g": _required_float(payload, "protein_g", minimum=0),
        "carbs_g": _required_float(payload, "carbs_g", minimum=0),
        "fat_g": _required_float(payload, "fat_g", minimum=0),
        "is_favorite": 1 if _optional_bool_flag(payload, "is_favorite", default=False) else 0,
    }


def _validate_gym_exercise_payload(payload: dict) -> dict[str, object]:
    routine_id = get_optional_int(payload, "routine_id", minimum=1)
    if routine_id is None:
        raise ValidationError("Routine is required.", "routine_id")
    if not query_db("SELECT id FROM gym_routines WHERE id = ?", [routine_id], one=True):
        raise ValidationError("Gym routine not found.", "routine_id", status_code=404)

    return {
        "routine_id": routine_id,
        "name": get_required_string(payload, "name", max_length=140),
        "day_of_week": get_optional_int(payload, "day_of_week", minimum=0, maximum=6),
        "machine": get_optional_string(payload, "machine", max_length=140, default="") or "",
        "muscle_group": get_optional_string(payload, "muscle_group", max_length=120, default="") or "",
        "sets": get_optional_int(payload, "sets", minimum=0),
        "reps": get_optional_string(payload, "reps", max_length=80, default="") or "",
        "target_weight": _optional_float(payload, "target_weight", minimum=0),
        "notes": get_optional_string(payload, "notes", max_length=1000, default="") or "",
        "display_order": get_optional_int(payload, "display_order", minimum=0) or _next_gym_exercise_order(routine_id),
    }


def _next_food_preset_order() -> int:
    row = query_db("SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM food_presets", one=True)
    return int(row["next_order"] or 1)


def _next_gym_exercise_order(routine_id: int) -> int:
    row = query_db(
        "SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM gym_exercises WHERE routine_id = ?",
        [routine_id],
        one=True,
    )
    return int(row["next_order"] or 1)


def _normalize_food_preset_order() -> None:
    rows = query_db(
        """
        SELECT id, display_order
        FROM food_presets
        ORDER BY COALESCE(display_order, 0) ASC, name COLLATE NOCASE ASC, id ASC
        """
    )
    for index, row in enumerate(rows, start=1):
        if int(row["display_order"] or 0) == index:
            continue
        execute_db("UPDATE food_presets SET display_order = ? WHERE id = ?", (index, row["id"]))
