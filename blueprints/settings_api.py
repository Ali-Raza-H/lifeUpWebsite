from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path

from flask import Blueprint, current_app, jsonify, send_file

from database import query_db
from utils import rows_to_dicts

bp = Blueprint("settings_api", __name__, url_prefix="/api/settings")


@bp.route("/export/json", methods=["GET"])
def export_json():
    data = {
        "tasks": rows_to_dicts(query_db("SELECT * FROM tasks ORDER BY id ASC")),
        "habits": rows_to_dicts(query_db("SELECT * FROM habits ORDER BY id ASC")),
        "habit_logs": rows_to_dicts(query_db("SELECT * FROM habit_logs ORDER BY id ASC")),
        "projects": rows_to_dicts(query_db("SELECT * FROM projects ORDER BY id ASC")),
        "project_milestones": rows_to_dicts(query_db("SELECT * FROM project_milestones ORDER BY id ASC")),
        "project_notes": rows_to_dicts(query_db("SELECT * FROM project_notes ORDER BY id ASC")),
        "project_habits": rows_to_dicts(query_db("SELECT * FROM project_habits ORDER BY project_id ASC, habit_id ASC")),
        "goals": rows_to_dicts(query_db("SELECT * FROM goals ORDER BY id ASC")),
        "goal_links": rows_to_dicts(query_db("SELECT * FROM goal_links ORDER BY goal_id ASC, id ASC")),
        "goal_milestones": rows_to_dicts(query_db("SELECT * FROM goal_milestones ORDER BY goal_id ASC, id ASC")),
        "journal_entries": rows_to_dicts(query_db("SELECT * FROM journal_entries ORDER BY id ASC")),
        "notes": rows_to_dicts(query_db("SELECT * FROM notes ORDER BY id ASC")),
        "traits": rows_to_dicts(query_db("SELECT * FROM traits ORDER BY id ASC")),
        "beliefs": rows_to_dicts(query_db("SELECT * FROM beliefs ORDER BY id ASC")),
        "skills": rows_to_dicts(query_db("SELECT * FROM skills ORDER BY id ASC")),
        "calendar_events": rows_to_dicts(query_db("SELECT * FROM calendar_events ORDER BY id ASC")),
        "health_logs": rows_to_dicts(query_db("SELECT * FROM health_logs ORDER BY id ASC")),
        "finance_entries": rows_to_dicts(query_db("SELECT * FROM finance_entries ORDER BY id ASC")),
        "contacts": rows_to_dicts(query_db("SELECT * FROM contacts ORDER BY id ASC")),
        "life_reviews": rows_to_dicts(query_db("SELECT * FROM life_reviews ORDER BY id ASC")),
        "attachments": rows_to_dicts(query_db("SELECT * FROM attachments ORDER BY id ASC")),
    }

    payload = json.dumps(data, indent=2).encode("utf-8")
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
