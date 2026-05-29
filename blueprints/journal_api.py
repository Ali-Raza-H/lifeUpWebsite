from __future__ import annotations

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from utils import get_optional_int, get_optional_string, get_required_string, iso_now, require_object, row_to_dict, rows_to_dicts

bp = Blueprint("journal_api", __name__, url_prefix="/api/journal")


@bp.route("/", methods=["GET"])
def get_entries():
    filters = []
    params: list = []

    query_text = request.args.get("q", "").strip()
    if query_text:
        pattern = f"%{query_text.lower()}%"
        filters.append("(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ?)")
        params.extend([pattern, pattern, pattern])

    mood = request.args.get("mood", type=int)
    if mood is not None:
        filters.append("mood_score = ?")
        params.append(mood)

    date_from = request.args.get("date_from")
    if date_from:
        filters.append("DATE(entry_date) >= ?")
        params.append(date_from)

    date_to = request.args.get("date_to")
    if date_to:
        filters.append("DATE(entry_date) <= ?")
        params.append(date_to)

    query = "SELECT * FROM journal_entries"
    if filters:
        query += f" WHERE {' AND '.join(filters)}"
    query += " ORDER BY entry_date DESC, id DESC"
    entries = query_db(query, params)
    return jsonify(rows_to_dicts(entries))


@bp.route("/", methods=["POST"])
def create_entry():
    payload = require_object(request.get_json(silent=True))
    content = get_required_string(payload, "content", max_length=10000)
    title = get_optional_string(payload, "title", max_length=140, default="") or ""
    tags = get_optional_string(payload, "tags", max_length=500, default="") or ""
    mood_score = get_optional_int(payload, "mood_score", default=5, minimum=1, maximum=10) or 5

    entry_id = execute_db(
        "INSERT INTO journal_entries (title, content, tags, mood_score, updated_at) VALUES (?, ?, ?, ?, ?)",
        (title, content, tags, mood_score, iso_now()),
    )
    entry = query_db("SELECT * FROM journal_entries WHERE id = ?", [entry_id], one=True)
    return jsonify({"entry": row_to_dict(entry), "message": "Entry created."}), 201


@bp.route("/<int:entry_id>", methods=["PUT"])
def update_entry(entry_id: int):
    entry = query_db("SELECT * FROM journal_entries WHERE id = ?", [entry_id], one=True)
    if not entry:
        return jsonify({"error": "Journal entry not found."}), 404

    current = row_to_dict(entry)
    payload = require_object(request.get_json(silent=True))
    title = get_optional_string(payload, "title", max_length=140, default=current.get("title", "")) if "title" in payload else current.get("title", "")
    content = get_required_string({"content": payload.get("content", current["content"])}, "content", max_length=10000)
    tags = get_optional_string(payload, "tags", max_length=500, default=current.get("tags", "")) if "tags" in payload else current.get("tags", "")
    mood_score = get_optional_int(payload, "mood_score", default=current.get("mood_score", 5), minimum=1, maximum=10)

    execute_db(
        "UPDATE journal_entries SET title = ?, content = ?, tags = ?, mood_score = ?, updated_at = ? WHERE id = ?",
        (title, content, tags, mood_score, iso_now(), entry_id),
    )
    updated = query_db("SELECT * FROM journal_entries WHERE id = ?", [entry_id], one=True)
    return jsonify({"entry": row_to_dict(updated), "message": "Entry updated."})


@bp.route("/<int:entry_id>", methods=["DELETE"])
def delete_entry(entry_id: int):
    entry = query_db("SELECT id FROM journal_entries WHERE id = ?", [entry_id], one=True)
    if not entry:
        return jsonify({"error": "Journal entry not found."}), 404

    execute_db("DELETE FROM journal_entries WHERE id = ?", [entry_id])
    return jsonify({"message": "Entry deleted."})
