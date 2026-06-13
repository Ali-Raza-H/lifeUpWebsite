from __future__ import annotations

from datetime import datetime
from io import BytesIO
import json
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request, send_file

from database import get_db, query_db
from services import mark_profile_defaults_dirty, normalize_profile_orders, reset_profile_defaults
from utils import ValidationError, require_object, rows_to_dicts

bp = Blueprint("settings_api", __name__, url_prefix="/api/settings")

EXPORT_TABLES = (
    ("tasks", "id ASC"),
    ("habits", "id ASC"),
    ("habit_logs", "id ASC"),
    ("projects", "id ASC"),
    ("project_milestones", "project_id ASC, id ASC"),
    ("project_notes", "project_id ASC, id ASC"),
    ("notebook_folders", "folder_type ASC, name ASC, id ASC"),
    ("folder_notes", "folder_id ASC, id ASC"),
    ("notebooks", "folder_id ASC, display_order ASC, id ASC"),
    ("notebook_pages", "notebook_id ASC, page_number ASC, id ASC"),
    ("project_habits", "project_id ASC, habit_id ASC"),
    ("goals", "id ASC"),
    ("goal_links", "goal_id ASC, id ASC"),
    ("goal_milestones", "goal_id ASC, id ASC"),
    ("journal_entries", "id ASC"),
    ("notes", "id ASC"),
    ("traits", "display_order ASC, id ASC"),
    ("beliefs", "display_order ASC, id ASC"),
    ("skills", "display_order ASC, id ASC"),
    ("calendar_events", "id ASC"),
    ("health_logs", "id ASC"),
    ("finance_entries", "id ASC"),
    ("contacts", "id ASC"),
    ("life_reviews", "id ASC"),
    ("attachments", "id ASC"),
    ("food_presets", "display_order ASC, id ASC"),
    ("diet_entries", "id ASC"),
    ("work_experiences", "id ASC"),
    ("linkedin_drafts", "id ASC"),
)
IMPORT_TABLE_ORDER = [table_name for table_name, _order_clause in EXPORT_TABLES]
ATTACHMENT_ENTITY_TABLES = {
    "calendar_event": "calendar_events",
    "contact": "contacts",
    "finance_entry": "finance_entries",
    "general": None,
    "goal": "goals",
    "habit": "habits",
    "health_log": "health_logs",
    "journal": "journal_entries",
    "journal_entry": "journal_entries",
    "life_review": "life_reviews",
    "note": "notes",
    "project": "projects",
    "task": "tasks",
}


@bp.route("/system", methods=["GET"])
def system_summary():
    return jsonify(_build_system_summary())


@bp.route("/export/json", methods=["GET"])
def export_json():
    payload = json.dumps(_build_export_payload(), indent=2).encode("utf-8")
    return send_file(
        BytesIO(payload),
        mimetype="application/json",
        as_attachment=True,
        download_name="lifeup_export.json",
    )


@bp.route("/export/db", methods=["GET"])
def export_db():
    db_path = Path(current_app.config["DATABASE"])
    if db_path.exists():
        return send_file(db_path, as_attachment=True, download_name=db_path.name)
    return jsonify({"error": "Database file not found."}), 404


@bp.route("/import/json", methods=["POST"])
def import_json():
    payload = request.get_json(silent=True)
    data = _extract_import_payload(payload)
    counts = _restore_from_export(data)
    return jsonify(
        {
            "message": "Backup restored successfully.",
            "counts": counts,
            "system": _build_system_summary(),
        }
    )


@bp.route("/maintenance/profile/reset", methods=["POST"])
def reset_profile():
    counts = reset_profile_defaults()
    return jsonify(
        {
            "message": "Profile traits, beliefs, and skills were reset to defaults.",
            "counts": counts,
            "system": _build_system_summary(),
        }
    )


@bp.route("/maintenance/attachments/prune", methods=["POST"])
def prune_attachments():
    removed_ids = _prune_orphaned_attachments()
    return jsonify(
        {
            "message": f"Removed {len(removed_ids)} orphaned attachment(s).",
            "removed_ids": removed_ids,
            "system": _build_system_summary(),
        }
    )


@bp.route("/maintenance/database/vacuum", methods=["POST"])
def vacuum_database():
    db = get_db()
    db.commit()
    db.execute("VACUUM")
    return jsonify({"message": "Database vacuum completed.", "system": _build_system_summary()})


def _build_export_payload() -> dict[str, list[dict]]:
    return {
        table_name: rows_to_dicts(query_db(f"SELECT * FROM {table_name} ORDER BY {order_clause}"))
        for table_name, order_clause in EXPORT_TABLES
    }


def _extract_import_payload(payload: object) -> dict[str, list[dict]]:
    if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        payload = payload["data"]

    data = require_object(payload)
    normalized: dict[str, list[dict]] = {}
    for table_name, _order_clause in EXPORT_TABLES:
        rows = data.get(table_name, [])
        if not isinstance(rows, list):
            raise ValidationError(f"{table_name} must be a list.", table_name)
        for row in rows:
            if not isinstance(row, dict):
                raise ValidationError(f"{table_name} must contain only objects.", table_name)
        normalized[table_name] = rows
    return normalized


def _restore_from_export(data: dict[str, list[dict]]) -> dict[str, int]:
    db = get_db()
    try:
        db.execute("PRAGMA foreign_keys = OFF")
        db.execute("BEGIN")

        for table_name in reversed(IMPORT_TABLE_ORDER):
            db.execute(f"DELETE FROM {table_name}")

        for table_name in IMPORT_TABLE_ORDER:
            table_columns = _table_columns(table_name)
            for row in data.get(table_name, []):
                filtered_row = {key: row[key] for key in table_columns if key in row}
                if not filtered_row:
                    continue
                columns = list(filtered_row.keys())
                placeholders = ", ".join("?" for _ in columns)
                db.execute(
                    f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES ({placeholders})",
                    [filtered_row[column] for column in columns],
                )

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.execute("PRAGMA foreign_keys = ON")

    mark_profile_defaults_dirty()
    normalize_profile_orders()
    return {
        table_name: int(query_db(f"SELECT COUNT(*) AS count FROM {table_name}", one=True)["count"] or 0)
        for table_name in IMPORT_TABLE_ORDER
    }


def _table_columns(table_name: str) -> list[str]:
    db = get_db()
    rows = db.execute(f"PRAGMA table_info({table_name})").fetchall()
    return [row["name"] for row in rows]


def _build_system_summary() -> dict[str, object]:
    db_path = Path(current_app.config["DATABASE"])
    record_counts = {
        table_name: int(query_db(f"SELECT COUNT(*) AS count FROM {table_name}", one=True)["count"] or 0)
        for table_name in IMPORT_TABLE_ORDER
    }
    total_records = sum(record_counts.values())
    orphan_attachments = _collect_orphan_attachment_ids()

    return {
        "status": "online",
        "version": current_app.config["APP_VERSION"],
        "database": {
            "name": db_path.name,
            "path": str(db_path),
            "size_bytes": db_path.stat().st_size if db_path.exists() else 0,
            "modified_at": datetime.fromtimestamp(db_path.stat().st_mtime).isoformat() if db_path.exists() else None,
        },
        "record_counts": record_counts,
        "total_records": total_records,
        "profile_summary": {
            "traits": record_counts["traits"],
            "beliefs": record_counts["beliefs"],
            "skills": record_counts["skills"],
        },
        "orphan_attachment_count": len(orphan_attachments),
        "orphan_attachment_ids": orphan_attachments,
    }


def _collect_orphan_attachment_ids() -> list[int]:
    rows = rows_to_dicts(query_db("SELECT id, entity_type, entity_id FROM attachments ORDER BY id ASC"))
    orphan_ids: list[int] = []
    for row in rows:
        entity_type = str(row.get("entity_type") or "").strip()
        if entity_type not in ATTACHMENT_ENTITY_TABLES:
            orphan_ids.append(int(row["id"]))
            continue
        table_name = ATTACHMENT_ENTITY_TABLES[entity_type]
        entity_id = row.get("entity_id")
        if table_name is None:
            continue
        if entity_id is None:
            continue
        exists = query_db(f"SELECT id FROM {table_name} WHERE id = ?", [entity_id], one=True)
        if not exists:
            orphan_ids.append(int(row["id"]))
    return orphan_ids


def _prune_orphaned_attachments() -> list[int]:
    orphan_ids = _collect_orphan_attachment_ids()
    if not orphan_ids:
        return []

    db = get_db()
    placeholders = ", ".join("?" for _ in orphan_ids)
    db.execute(f"DELETE FROM attachments WHERE id IN ({placeholders})", orphan_ids)
    db.commit()
    return orphan_ids
