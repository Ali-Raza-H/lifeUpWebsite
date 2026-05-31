from __future__ import annotations

from datetime import date

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

bp = Blueprint("library_api", __name__, url_prefix="/api/library")

MEDIA_TYPES = {"book", "manga", "manhwa", "anime", "tv", "movie"}
MEDIA_STATUSES = {"want_to_start", "in_progress", "completed", "paused", "dropped"}


def _serialize_media_payload(payload: dict, current: dict | None = None) -> dict:
    current = current or {}
    title = (
        get_required_string(payload, "title", max_length=180)
        if current == {}
        else get_optional_string(payload, "title", max_length=180, default=current.get("title")) or current.get("title")
    )
    media_type = (
        get_optional_choice(payload, "media_type", allowed=MEDIA_TYPES, default=current.get("media_type") or "book")
        or current.get("media_type")
        or "book"
    )
    status = (
        get_optional_choice(payload, "status", allowed=MEDIA_STATUSES, default=current.get("status") or "want_to_start")
        or current.get("status")
        or "want_to_start"
    )
    creator = get_optional_string(payload, "creator", max_length=160, default=current.get("creator") or "") or ""
    platform = get_optional_string(payload, "platform", max_length=120, default=current.get("platform") or "") or ""
    current_unit = (
        get_optional_int(payload, "current_unit", minimum=0)
        if "current_unit" in payload
        else current.get("current_unit")
    )
    total_units = (
        get_optional_int(payload, "total_units", minimum=1)
        if "total_units" in payload
        else current.get("total_units")
    )
    score = get_optional_int(payload, "score", minimum=1, maximum=10) if "score" in payload else current.get("score")
    started_on = get_optional_date(payload, "started_on") if "started_on" in payload else current.get("started_on")
    completed_on = get_optional_date(payload, "completed_on") if "completed_on" in payload else current.get("completed_on")
    notes = get_optional_string(payload, "notes", max_length=3000, default=current.get("notes") or "") or ""

    if total_units is not None and current_unit is not None and current_unit > total_units:
        raise ValidationError("Current progress cannot be higher than total progress.", "current_unit")
    if started_on and completed_on and completed_on < started_on:
        raise ValidationError("Completed date cannot be earlier than started date.", "completed_on")
    if status == "completed" and completed_on is None:
        completed_on = date.today().isoformat()

    return {
        "title": title,
        "media_type": media_type,
        "status": status,
        "creator": creator,
        "platform": platform,
        "current_unit": current_unit,
        "total_units": total_units,
        "score": score,
        "started_on": started_on,
        "completed_on": completed_on,
        "notes": notes,
    }


@bp.route("/summary", methods=["GET"])
def get_summary():
    summary = query_db(
        """
        SELECT
            COUNT(*) AS total_items,
            SUM(CASE WHEN status = 'want_to_start' THEN 1 ELSE 0 END) AS want_to_start_count,
            SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
            SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused_count,
            SUM(CASE WHEN status = 'dropped' THEN 1 ELSE 0 END) AS dropped_count,
            ROUND(AVG(score), 1) AS average_score
        FROM media_items
        """,
        one=True,
    )
    type_rows = rows_to_dicts(
        query_db(
            """
            SELECT media_type, COUNT(*) AS count
            FROM media_items
            GROUP BY media_type
            """
        )
    )
    return jsonify(
        {
            **row_to_dict(summary),
            "type_breakdown": {row["media_type"]: int(row["count"] or 0) for row in type_rows},
        }
    )


@bp.route("/items", methods=["GET"])
def get_items():
    media_type = request.args.get("type")
    if media_type:
        media_type = get_optional_choice({"type": media_type}, "type", allowed=MEDIA_TYPES)
    rows = query_db(
        """
        SELECT *
        FROM media_items
        WHERE (? IS NULL OR media_type = ?)
        ORDER BY
            CASE status
                WHEN 'in_progress' THEN 0
                WHEN 'want_to_start' THEN 1
                WHEN 'paused' THEN 2
                WHEN 'completed' THEN 3
                ELSE 4
            END,
            COALESCE(completed_on, started_on, DATE(updated_at), DATE(created_at)) DESC,
            updated_at DESC,
            title COLLATE NOCASE ASC,
            id DESC
        """,
        [media_type, media_type],
    )
    return jsonify(rows_to_dicts(rows))


@bp.route("/items", methods=["POST"])
def create_item():
    payload = require_object(request.get_json(silent=True))
    item = _serialize_media_payload(payload)
    item_id = execute_db(
        """
        INSERT INTO media_items (
            title, media_type, status, creator, platform, current_unit, total_units,
            score, started_on, completed_on, notes, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (
            item["title"],
            item["media_type"],
            item["status"],
            item["creator"],
            item["platform"],
            item["current_unit"],
            item["total_units"],
            item["score"],
            item["started_on"],
            item["completed_on"],
            item["notes"],
        ),
    )
    created = query_db("SELECT * FROM media_items WHERE id = ?", [item_id], one=True)
    return jsonify({"item": row_to_dict(created), "message": "Library item saved."}), 201


@bp.route("/items/<int:item_id>", methods=["PUT"])
def update_item(item_id: int):
    existing_row = query_db("SELECT * FROM media_items WHERE id = ?", [item_id], one=True)
    if not existing_row:
        return jsonify({"error": "Library item not found."}), 404

    payload = require_object(request.get_json(silent=True))
    item = _serialize_media_payload(payload, row_to_dict(existing_row))
    execute_db(
        """
        UPDATE media_items
        SET
            title = ?,
            media_type = ?,
            status = ?,
            creator = ?,
            platform = ?,
            current_unit = ?,
            total_units = ?,
            score = ?,
            started_on = ?,
            completed_on = ?,
            notes = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
            item["title"],
            item["media_type"],
            item["status"],
            item["creator"],
            item["platform"],
            item["current_unit"],
            item["total_units"],
            item["score"],
            item["started_on"],
            item["completed_on"],
            item["notes"],
            item_id,
        ),
    )
    updated = query_db("SELECT * FROM media_items WHERE id = ?", [item_id], one=True)
    return jsonify({"item": row_to_dict(updated), "message": "Library item updated."})


@bp.route("/items/<int:item_id>", methods=["DELETE"])
def delete_item(item_id: int):
    row = query_db("SELECT id FROM media_items WHERE id = ?", [item_id], one=True)
    if not row:
        return jsonify({"error": "Library item not found."}), 404
    execute_db("DELETE FROM media_items WHERE id = ?", [item_id])
    return jsonify({"message": "Library item deleted."})
