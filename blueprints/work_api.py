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

bp = Blueprint("work_api", __name__, url_prefix="/api/work")

EXPERIENCE_TYPES = {"job", "work_experience", "internship", "apprenticeship", "volunteering", "freelance"}
WORK_STATUSES = {"saved", "applied", "interviewing", "active", "completed", "rejected"}


@bp.route("/summary", methods=["GET"])
def get_work_summary():
    totals = query_db(
        """
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status IN ('saved', 'applied', 'interviewing') THEN 1 ELSE 0 END) AS pipeline_count,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count
        FROM work_experiences
        """,
        one=True,
    )
    type_rows = query_db(
        """
        SELECT experience_type, COUNT(*) AS count
        FROM work_experiences
        GROUP BY experience_type
        ORDER BY count DESC, experience_type ASC
        """
    )
    return jsonify(
        {
            "total": int(totals["total"] or 0),
            "pipeline_count": int(totals["pipeline_count"] or 0),
            "active_count": int(totals["active_count"] or 0),
            "completed_count": int(totals["completed_count"] or 0),
            "type_breakdown": rows_to_dicts(type_rows),
        }
    )


@bp.route("/experiences", methods=["GET"])
def get_work_experiences():
    filters: list[str] = []
    params: list[object] = []

    status = request.args.get("status", "").strip()
    if status:
        status = get_optional_choice({"status": status}, "status", allowed=WORK_STATUSES) or ""
        filters.append("status = ?")
        params.append(status)

    experience_type = request.args.get("type", "").strip()
    if experience_type:
        experience_type = (
            get_optional_choice({"experience_type": experience_type}, "experience_type", allowed=EXPERIENCE_TYPES)
            or ""
        )
        filters.append("experience_type = ?")
        params.append(experience_type)

    query_text = request.args.get("q", "").strip().lower()
    if query_text:
        filters.append(
            """
            LOWER(
                title || ' ' || organization || ' ' || COALESCE(location, '') || ' ' ||
                COALESCE(skills, '') || ' ' || COALESCE(responsibilities, '') || ' ' ||
                COALESCE(achievements, '') || ' ' || COALESCE(notes, '')
            ) LIKE ?
            """
        )
        params.append(f"%{query_text}%")

    query = "SELECT * FROM work_experiences"
    if filters:
        query += f" WHERE {' AND '.join(filters)}"
    query += """
        ORDER BY
            CASE status
                WHEN 'interviewing' THEN 0
                WHEN 'applied' THEN 1
                WHEN 'active' THEN 2
                WHEN 'saved' THEN 3
                WHEN 'completed' THEN 4
                ELSE 5
            END,
            COALESCE(start_date, created_at) DESC,
            updated_at DESC,
            id DESC
        LIMIT 200
    """
    return jsonify(rows_to_dicts(query_db(query, params)))


@bp.route("/experiences", methods=["POST"])
def create_work_experience():
    payload = require_object(request.get_json(silent=True))
    data = _validate_work_payload(payload)
    item_id = execute_db(
        """
        INSERT INTO work_experiences (
            title, organization, experience_type, status, location, start_date, end_date, hours_per_week,
            skills, responsibilities, achievements, application_url, notes, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (
            data["title"],
            data["organization"],
            data["experience_type"],
            data["status"],
            data["location"],
            data["start_date"],
            data["end_date"],
            data["hours_per_week"],
            data["skills"],
            data["responsibilities"],
            data["achievements"],
            data["application_url"],
            data["notes"],
        ),
    )
    item = query_db("SELECT * FROM work_experiences WHERE id = ?", [item_id], one=True)
    return jsonify({"experience": row_to_dict(item), "message": "Work experience saved."}), 201


@bp.route("/experiences/<int:experience_id>", methods=["PUT"])
def update_work_experience(experience_id: int):
    row = query_db("SELECT * FROM work_experiences WHERE id = ?", [experience_id], one=True)
    if not row:
        return jsonify({"error": "Work experience not found."}), 404

    current = row_to_dict(row)
    payload = require_object(request.get_json(silent=True))
    merged = {**current, **payload}
    data = _validate_work_payload(merged)

    execute_db(
        """
        UPDATE work_experiences
        SET
            title = ?,
            organization = ?,
            experience_type = ?,
            status = ?,
            location = ?,
            start_date = ?,
            end_date = ?,
            hours_per_week = ?,
            skills = ?,
            responsibilities = ?,
            achievements = ?,
            application_url = ?,
            notes = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
            data["title"],
            data["organization"],
            data["experience_type"],
            data["status"],
            data["location"],
            data["start_date"],
            data["end_date"],
            data["hours_per_week"],
            data["skills"],
            data["responsibilities"],
            data["achievements"],
            data["application_url"],
            data["notes"],
            experience_id,
        ),
    )
    updated = query_db("SELECT * FROM work_experiences WHERE id = ?", [experience_id], one=True)
    return jsonify({"experience": row_to_dict(updated), "message": "Work experience updated."})


@bp.route("/experiences/<int:experience_id>", methods=["DELETE"])
def delete_work_experience(experience_id: int):
    row = query_db("SELECT id FROM work_experiences WHERE id = ?", [experience_id], one=True)
    if not row:
        return jsonify({"error": "Work experience not found."}), 404
    execute_db("DELETE FROM work_experiences WHERE id = ?", [experience_id])
    return jsonify({"message": "Work experience deleted."})


def _validate_work_payload(payload: dict) -> dict[str, object]:
    title = get_required_string(payload, "title", max_length=160)
    organization = get_required_string(payload, "organization", max_length=160)
    experience_type = (
        get_optional_choice(payload, "experience_type", allowed=EXPERIENCE_TYPES, default="job") or "job"
    )
    status = get_optional_choice(payload, "status", allowed=WORK_STATUSES, default="saved") or "saved"
    location = get_optional_string(payload, "location", max_length=160, default="") or ""
    start_date = get_optional_date(payload, "start_date")
    end_date = get_optional_date(payload, "end_date")
    if start_date and end_date and end_date < start_date:
        raise ValidationError("End date cannot be before start date.", "end_date")

    return {
        "title": title,
        "organization": organization,
        "experience_type": experience_type,
        "status": status,
        "location": location,
        "start_date": start_date,
        "end_date": end_date,
        "hours_per_week": get_optional_int(payload, "hours_per_week", minimum=0, maximum=168),
        "skills": get_optional_string(payload, "skills", max_length=1000, default="") or "",
        "responsibilities": get_optional_string(payload, "responsibilities", max_length=4000, default="") or "",
        "achievements": get_optional_string(payload, "achievements", max_length=4000, default="") or "",
        "application_url": _optional_url(payload, "application_url"),
        "notes": get_optional_string(payload, "notes", max_length=3000, default="") or "",
    }


def _optional_url(payload: dict, field: str) -> str:
    raw_value = get_optional_string(payload, field, max_length=1000, default="") or ""
    if not raw_value:
        return ""
    value = raw_value if "://" in raw_value else f"https://{raw_value}"
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValidationError("Application url must be a valid website link.", field)
    return value
