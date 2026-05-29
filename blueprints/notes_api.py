from __future__ import annotations

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from utils import (
    get_optional_int,
    get_optional_string,
    get_required_string,
    iso_now,
    require_object,
    row_to_dict,
    rows_to_dicts,
)

bp = Blueprint("notes_api", __name__, url_prefix="/api/notes")

@bp.route("/", methods=["GET"])
def get_notes():
    filters = []
    params: list = []
    query_text = request.args.get("q", "").strip()
    if query_text:
        filters.append("(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ?)")
        pattern = f"%{query_text.lower()}%"
        params.extend([pattern, pattern, pattern])

    pinned_only = request.args.get("pinned", type=int)
    if pinned_only == 1:
        filters.append("is_pinned = 1")

    query = "SELECT * FROM notes"
    if filters:
        query += f" WHERE {' AND '.join(filters)}"
    query += " ORDER BY is_pinned DESC, updated_at DESC, id DESC"
    return jsonify(rows_to_dicts(query_db(query, params)))

@bp.route("/<int:note_id>", methods=["GET"])
def get_note(note_id: int):
    note = query_db("SELECT * FROM notes WHERE id = ?", [note_id], one=True)
    if not note:
        return jsonify({"error": "Note not found."}), 404
    return jsonify(row_to_dict(note))

@bp.route("/", methods=["POST"])
def create_note():
    payload = require_object(request.get_json(silent=True))
    title = get_required_string(payload, "title", max_length=140)
    tags = get_optional_string(payload, "tags", max_length=500, default="") or ""
    is_pinned = get_optional_int(payload, "is_pinned", default=0, minimum=0, maximum=1) or 0
    content = get_optional_string(payload, "content", max_length=50000, default="") or ""

    note_id = execute_db(
        "INSERT INTO notes (title, tags, is_pinned, content) VALUES (?, ?, ?, ?)",
        (title, tags, is_pinned, content),
    )
    note = query_db("SELECT * FROM notes WHERE id = ?", [note_id], one=True)
    return jsonify({"note": row_to_dict(note), "message": "Note created."}), 201

@bp.route("/<int:note_id>", methods=["PUT"])
def update_note(note_id: int):
    note = query_db("SELECT * FROM notes WHERE id = ?", [note_id], one=True)
    if not note:
        return jsonify({"error": "Note not found."}), 404

    payload = require_object(request.get_json(silent=True))
    current_note = row_to_dict(note)

    title = get_optional_string(payload, "title", max_length=140, default=current_note["title"]) or current_note["title"]
    tags = get_optional_string(payload, "tags", max_length=500, default=current_note.get("tags", "")) if "tags" in payload else current_note.get("tags", "")
    is_pinned = get_optional_int(payload, "is_pinned", default=current_note.get("is_pinned", 0), minimum=0, maximum=1)
    content = (
        get_optional_string(payload, "content", max_length=50000, default=current_note["content"])
        if "content" in payload
        else current_note["content"]
    )
    
    updated_at = iso_now()

    execute_db(
        "UPDATE notes SET title = ?, tags = ?, is_pinned = ?, content = ?, updated_at = ? WHERE id = ?",
        (title, tags, is_pinned, content, updated_at, note_id),
    )
    updated = query_db("SELECT * FROM notes WHERE id = ?", [note_id], one=True)
    return jsonify({"note": row_to_dict(updated), "message": "Note updated."})

@bp.route("/<int:note_id>", methods=["DELETE"])
def delete_note(note_id: int):
    note = query_db("SELECT id FROM notes WHERE id = ?", [note_id], one=True)
    if not note:
        return jsonify({"error": "Note not found."}), 404

    execute_db("DELETE FROM notes WHERE id = ?", [note_id])
    return jsonify({"message": "Note deleted."})
