from __future__ import annotations

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from utils import get_optional_int, get_required_string, require_object, row_to_dict, rows_to_dicts

bp = Blueprint("journal_api", __name__, url_prefix="/api/journal")


@bp.route("/", methods=["GET"])
def get_entries():
    entries = query_db("SELECT * FROM journal_entries ORDER BY entry_date DESC, id DESC")
    return jsonify(rows_to_dicts(entries))


@bp.route("/", methods=["POST"])
def create_entry():
    payload = require_object(request.get_json(silent=True))
    content = get_required_string(payload, "content", max_length=10000)
    mood_score = get_optional_int(payload, "mood_score", default=5, minimum=1, maximum=10) or 5

    entry_id = execute_db(
        "INSERT INTO journal_entries (content, mood_score) VALUES (?, ?)",
        (content, mood_score),
    )
    entry = query_db("SELECT * FROM journal_entries WHERE id = ?", [entry_id], one=True)
    return jsonify({"entry": row_to_dict(entry), "message": "Entry created."}), 201


@bp.route("/<int:entry_id>", methods=["DELETE"])
def delete_entry(entry_id: int):
    entry = query_db("SELECT id FROM journal_entries WHERE id = ?", [entry_id], one=True)
    if not entry:
        return jsonify({"error": "Journal entry not found."}), 404

    execute_db("DELETE FROM journal_entries WHERE id = ?", [entry_id])
    return jsonify({"message": "Entry deleted."})
