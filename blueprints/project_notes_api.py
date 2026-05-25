from __future__ import annotations

from flask import Blueprint, jsonify, request

from database import execute_db, query_db
from utils import (
    get_optional_string,
    get_required_string,
    require_object,
    row_to_dict,
    iso_now,
)

bp = Blueprint("project_notes_api", __name__, url_prefix="/api/projects/<int:project_id>/notes")

@bp.route("/", methods=["GET"])
def list_notes(project_id: int):
    notes = query_db(
        "SELECT * FROM project_notes WHERE project_id = ? ORDER BY updated_at DESC",
        [project_id]
    )
    return jsonify([row_to_dict(n) for n in notes])

@bp.route("/", methods=["POST"])
def create_note(project_id: int):
    payload = require_object(request.get_json(silent=True))
    title = get_required_string(payload, "title", max_length=140)
    content = get_optional_string(payload, "content", max_length=10000, default="") or ""
    
    note_id = execute_db(
        "INSERT INTO project_notes (project_id, title, content) VALUES (?, ?, ?)",
        (project_id, title, content)
    )
    note = query_db("SELECT * FROM project_notes WHERE id = ?", [note_id], one=True)
    return jsonify({"note": row_to_dict(note), "message": "Note created."}), 201

@bp.route("/<int:note_id>", methods=["GET"])
def get_note(project_id: int, note_id: int):
    note = query_db(
        "SELECT * FROM project_notes WHERE id = ? AND project_id = ?",
        [note_id, project_id],
        one=True
    )
    if not note:
        return jsonify({"error": "Note not found."}), 404
    return jsonify(row_to_dict(note))

@bp.route("/<int:note_id>", methods=["PUT"])
def update_note(project_id: int, note_id: int):
    note = query_db(
        "SELECT * FROM project_notes WHERE id = ? AND project_id = ?",
        [note_id, project_id],
        one=True
    )
    if not note:
        return jsonify({"error": "Note not found."}), 404

    current_note = row_to_dict(note)
    payload = require_object(request.get_json(silent=True))
    
    title = get_optional_string(payload, "title", max_length=140, default=current_note["title"]) or current_note["title"]
    content = get_optional_string(payload, "content", max_length=10000, default=current_note["content"]) or current_note["content"]
    
    execute_db(
        "UPDATE project_notes SET title = ?, content = ?, updated_at = ? WHERE id = ?",
        (title, content, iso_now(), note_id)
    )
    
    updated = query_db("SELECT * FROM project_notes WHERE id = ?", [note_id], one=True)
    return jsonify({"note": row_to_dict(updated), "message": "Note updated."})

@bp.route("/<int:note_id>", methods=["DELETE"])
def delete_note(project_id: int, note_id: int):
    note = query_db(
        "SELECT id FROM project_notes WHERE id = ? AND project_id = ?",
        [note_id, project_id],
        one=True
    )
    if not note:
        return jsonify({"error": "Note not found."}), 404

    execute_db("DELETE FROM project_notes WHERE id = ?", [note_id])
    return jsonify({"message": "Note deleted."})
