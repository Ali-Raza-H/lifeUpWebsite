from __future__ import annotations

from flask import Blueprint, jsonify, request

from database import ensure_project_notebook_folder, execute_db, get_db, query_db
from utils import (
    get_optional_int,
    get_optional_string,
    get_required_string,
    iso_now,
    require_object,
    row_to_dict,
    rows_to_dicts,
)

bp = Blueprint("notebooks_api", __name__, url_prefix="/api/notebooks")


def _folder_or_404(folder_id: int):
    folder = query_db("SELECT * FROM notebook_folders WHERE id = ?", [folder_id], one=True)
    if not folder:
        return None, (jsonify({"error": "Folder not found."}), 404)
    return row_to_dict(folder), None


def _notebook_or_404(notebook_id: int):
    notebook = query_db("SELECT * FROM notebooks WHERE id = ?", [notebook_id], one=True)
    if not notebook:
        return None, (jsonify({"error": "Notebook not found."}), 404)
    return row_to_dict(notebook), None


@bp.route("/workspace", methods=["GET"])
def workspace():
    _sync_project_folders()
    _sync_project_notes()
    folders = rows_to_dicts(
        query_db(
            """
            SELECT
                nf.*,
                p.status AS project_status,
                COUNT(DISTINCT n.id) AS notebook_count,
                COUNT(DISTINCT fn.id) AS note_count
            FROM notebook_folders nf
            LEFT JOIN projects p ON p.id = nf.project_id
            LEFT JOIN notebooks n ON n.folder_id = nf.id
            LEFT JOIN folder_notes fn ON fn.folder_id = nf.id
            GROUP BY nf.id
            ORDER BY
                CASE WHEN nf.folder_type = 'Projects' THEN 0 ELSE 1 END,
                nf.folder_type ASC,
                nf.name ASC
            """
        )
    )
    return jsonify({"folders": folders})


@bp.route("/folders", methods=["POST"])
def create_folder():
    payload = require_object(request.get_json(silent=True))
    name = get_required_string(payload, "name", max_length=140)
    folder_type = get_optional_string(payload, "folder_type", max_length=80, default="Personal") or "Personal"
    folder_id = execute_db(
        "INSERT INTO notebook_folders (name, folder_type) VALUES (?, ?)",
        (name, folder_type),
    )
    folder = query_db("SELECT * FROM notebook_folders WHERE id = ?", [folder_id], one=True)
    return jsonify({"folder": row_to_dict(folder), "message": "Folder created."}), 201


@bp.route("/folders/<int:folder_id>", methods=["GET"])
def get_folder(folder_id: int):
    _sync_project_folders()
    _sync_project_notes()
    folder, error = _folder_or_404(folder_id)
    if error:
        return error
    notes = rows_to_dicts(query_db("SELECT * FROM folder_notes WHERE folder_id = ? ORDER BY updated_at DESC, id DESC", [folder_id]))
    notebooks = rows_to_dicts(query_db("SELECT * FROM notebooks WHERE folder_id = ? ORDER BY is_main DESC, display_order ASC, id ASC", [folder_id]))
    for notebook in notebooks:
        pages = rows_to_dicts(query_db("SELECT id, title, page_number, updated_at FROM notebook_pages WHERE notebook_id = ? ORDER BY page_number ASC, id ASC", [notebook["id"]]))
        notebook["pages"] = pages
        notebook["page_count"] = len(pages)
    folder["notes"] = notes
    folder["notebooks"] = notebooks
    return jsonify(folder)


@bp.route("/folders/<int:folder_id>", methods=["PUT"])
def update_folder(folder_id: int):
    folder, error = _folder_or_404(folder_id)
    if error:
        return error
    if folder.get("project_id"):
        return jsonify({"error": "Project folders are renamed from the project itself."}), 400
    payload = require_object(request.get_json(silent=True))
    name = get_optional_string(payload, "name", max_length=140, default=folder["name"]) or folder["name"]
    folder_type = get_optional_string(payload, "folder_type", max_length=80, default=folder["folder_type"]) or folder["folder_type"]
    execute_db(
        "UPDATE notebook_folders SET name = ?, folder_type = ?, updated_at = ? WHERE id = ?",
        (name, folder_type, iso_now(), folder_id),
    )
    updated = query_db("SELECT * FROM notebook_folders WHERE id = ?", [folder_id], one=True)
    return jsonify({"folder": row_to_dict(updated), "message": "Folder updated."})


@bp.route("/folders/<int:folder_id>", methods=["DELETE"])
def delete_folder(folder_id: int):
    folder, error = _folder_or_404(folder_id)
    if error:
        return error
    if folder.get("project_id"):
        return jsonify({"error": "Project folders cannot be deleted from notebooks."}), 400
    execute_db("DELETE FROM notebook_folders WHERE id = ?", [folder_id])
    return jsonify({"message": "Folder deleted."})


@bp.route("/folders/<int:folder_id>/notes", methods=["POST"])
def create_folder_note(folder_id: int):
    _folder, error = _folder_or_404(folder_id)
    if error:
        return error
    payload = require_object(request.get_json(silent=True))
    title = get_required_string(payload, "title", max_length=140)
    content = get_optional_string(payload, "content", max_length=50000, default="") or ""
    note_id = execute_db(
        "INSERT INTO folder_notes (folder_id, title, content) VALUES (?, ?, ?)",
        (folder_id, title, content),
    )
    note = query_db("SELECT * FROM folder_notes WHERE id = ?", [note_id], one=True)
    return jsonify({"note": row_to_dict(note), "message": "Note created."}), 201


@bp.route("/folder-notes/<int:note_id>", methods=["PUT"])
def update_folder_note(note_id: int):
    note = query_db("SELECT * FROM folder_notes WHERE id = ?", [note_id], one=True)
    if not note:
        return jsonify({"error": "Note not found."}), 404
    current = row_to_dict(note)
    payload = require_object(request.get_json(silent=True))
    title = get_optional_string(payload, "title", max_length=140, default=current["title"]) or current["title"]
    content = get_optional_string(payload, "content", max_length=50000, default=current["content"]) if "content" in payload else current["content"]
    execute_db(
        "UPDATE folder_notes SET title = ?, content = ?, updated_at = ? WHERE id = ?",
        (title, content, iso_now(), note_id),
    )
    updated = query_db("SELECT * FROM folder_notes WHERE id = ?", [note_id], one=True)
    return jsonify({"note": row_to_dict(updated), "message": "Note updated."})


@bp.route("/folder-notes/<int:note_id>", methods=["DELETE"])
def delete_folder_note(note_id: int):
    note = query_db("SELECT id FROM folder_notes WHERE id = ?", [note_id], one=True)
    if not note:
        return jsonify({"error": "Note not found."}), 404
    execute_db("DELETE FROM folder_notes WHERE id = ?", [note_id])
    return jsonify({"message": "Note deleted."})


@bp.route("/folders/<int:folder_id>/notebooks", methods=["POST"])
def create_notebook(folder_id: int):
    _folder, error = _folder_or_404(folder_id)
    if error:
        return error
    payload = require_object(request.get_json(silent=True))
    title = get_required_string(payload, "title", max_length=140)
    is_main = get_optional_int(payload, "is_main", default=0, minimum=0, maximum=1) or 0
    db = get_db()
    if is_main:
        db.execute("UPDATE notebooks SET is_main = 0 WHERE folder_id = ?", (folder_id,))
    order_row = db.execute("SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM notebooks WHERE folder_id = ?", (folder_id,)).fetchone()
    cur = db.execute(
        "INSERT INTO notebooks (folder_id, title, is_main, display_order) VALUES (?, ?, ?, ?)",
        (folder_id, title, is_main, int(order_row["next_order"] or 1)),
    )
    notebook_id = int(cur.lastrowid)
    db.execute(
        "INSERT INTO notebook_pages (notebook_id, title, content, page_number) VALUES (?, 'Page 1', '', 1)",
        (notebook_id,),
    )
    db.commit()
    notebook = query_db("SELECT * FROM notebooks WHERE id = ?", [notebook_id], one=True)
    return jsonify({"notebook": row_to_dict(notebook), "message": "Notebook created."}), 201


@bp.route("/notebooks/<int:notebook_id>", methods=["PUT"])
def update_notebook(notebook_id: int):
    notebook, error = _notebook_or_404(notebook_id)
    if error:
        return error
    payload = require_object(request.get_json(silent=True))
    title = get_optional_string(payload, "title", max_length=140, default=notebook["title"]) or notebook["title"]
    is_main = get_optional_int(payload, "is_main", default=notebook.get("is_main", 0), minimum=0, maximum=1)
    db = get_db()
    if is_main:
        db.execute("UPDATE notebooks SET is_main = 0 WHERE folder_id = ?", (notebook["folder_id"],))
    db.execute(
        "UPDATE notebooks SET title = ?, is_main = ?, updated_at = ? WHERE id = ?",
        (title, is_main, iso_now(), notebook_id),
    )
    db.commit()
    updated = query_db("SELECT * FROM notebooks WHERE id = ?", [notebook_id], one=True)
    return jsonify({"notebook": row_to_dict(updated), "message": "Notebook updated."})


@bp.route("/notebooks/<int:notebook_id>", methods=["DELETE"])
def delete_notebook(notebook_id: int):
    notebook, error = _notebook_or_404(notebook_id)
    if error:
        return error
    execute_db("DELETE FROM notebooks WHERE id = ?", [notebook_id])
    return jsonify({"message": "Notebook deleted."})


@bp.route("/notebooks/<int:notebook_id>/pages", methods=["POST"])
def create_page(notebook_id: int):
    _notebook, error = _notebook_or_404(notebook_id)
    if error:
        return error
    payload = require_object(request.get_json(silent=True))
    title = get_optional_string(payload, "title", max_length=140, default="New page") or "New page"
    content = get_optional_string(payload, "content", max_length=50000, default="") or ""
    db = get_db()
    page_row = db.execute("SELECT COALESCE(MAX(page_number), 0) + 1 AS next_page FROM notebook_pages WHERE notebook_id = ?", (notebook_id,)).fetchone()
    cur = db.execute(
        "INSERT INTO notebook_pages (notebook_id, title, content, page_number) VALUES (?, ?, ?, ?)",
        (notebook_id, title, content, int(page_row["next_page"] or 1)),
    )
    db.execute("UPDATE notebooks SET updated_at = ? WHERE id = ?", (iso_now(), notebook_id))
    db.commit()
    page = query_db("SELECT * FROM notebook_pages WHERE id = ?", [int(cur.lastrowid)], one=True)
    return jsonify({"page": row_to_dict(page), "message": "Page created."}), 201


@bp.route("/pages/<int:page_id>", methods=["GET"])
def get_page(page_id: int):
    page = query_db("SELECT * FROM notebook_pages WHERE id = ?", [page_id], one=True)
    if not page:
        return jsonify({"error": "Page not found."}), 404
    return jsonify(row_to_dict(page))


@bp.route("/pages/<int:page_id>", methods=["PUT"])
def update_page(page_id: int):
    page = query_db("SELECT * FROM notebook_pages WHERE id = ?", [page_id], one=True)
    if not page:
        return jsonify({"error": "Page not found."}), 404
    current = row_to_dict(page)
    payload = require_object(request.get_json(silent=True))
    title = get_optional_string(payload, "title", max_length=140, default=current["title"]) or current["title"]
    content = get_optional_string(payload, "content", max_length=50000, default=current["content"]) if "content" in payload else current["content"]
    updated_at = iso_now()
    db = get_db()
    db.execute(
        "UPDATE notebook_pages SET title = ?, content = ?, updated_at = ? WHERE id = ?",
        (title, content, updated_at, page_id),
    )
    db.execute("UPDATE notebooks SET updated_at = ? WHERE id = ?", (updated_at, current["notebook_id"]))
    db.commit()
    updated = query_db("SELECT * FROM notebook_pages WHERE id = ?", [page_id], one=True)
    return jsonify({"page": row_to_dict(updated), "message": "Page updated."})


@bp.route("/pages/<int:page_id>", methods=["DELETE"])
def delete_page(page_id: int):
    page = query_db("SELECT * FROM notebook_pages WHERE id = ?", [page_id], one=True)
    if not page:
        return jsonify({"error": "Page not found."}), 404
    execute_db("DELETE FROM notebook_pages WHERE id = ?", [page_id])
    return jsonify({"message": "Page deleted."})


def _sync_project_folders() -> None:
    projects = rows_to_dicts(query_db("SELECT id, name FROM projects ORDER BY id ASC"))
    db = get_db()
    for project in projects:
        ensure_project_notebook_folder(int(project["id"]), project["name"])
    db.commit()


def _sync_project_notes() -> None:
    rows = rows_to_dicts(
        query_db(
            """
            SELECT pn.id, pn.project_id, pn.title, pn.content, pn.created_at, pn.updated_at, p.name AS project_name
            FROM project_notes pn
            JOIN projects p ON p.id = pn.project_id
            ORDER BY pn.project_id ASC, pn.id ASC
            """
        )
    )
    db = get_db()
    for row in rows:
        folder = query_db("SELECT id FROM notebook_folders WHERE project_id = ?", [row["project_id"]], one=True)
        folder_id = int(folder["id"]) if folder else ensure_project_notebook_folder(int(row["project_id"]), row["project_name"])
        exists = query_db("SELECT id FROM folder_notes WHERE legacy_project_note_id = ?", [row["id"]], one=True)
        if exists:
            continue
        db.execute(
            """
            INSERT INTO folder_notes (folder_id, title, content, legacy_project_note_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (folder_id, row["title"], row["content"], row["id"], row["created_at"], row["updated_at"]),
        )
    db.commit()
