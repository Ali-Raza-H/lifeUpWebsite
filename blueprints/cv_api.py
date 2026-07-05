from __future__ import annotations

from io import BytesIO
import re

from flask import Blueprint, Response, jsonify, request
from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

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

bp = Blueprint("cv_api", __name__, url_prefix="/api/cv")

SECTION_TYPES = {"summary", "experience", "projects", "education", "skills", "certifications", "other"}
SECTION_ALIASES = {
    "summary": "summary",
    "profile": "summary",
    "personal profile": "summary",
    "experience": "experience",
    "work experience": "experience",
    "employment": "experience",
    "employment history": "experience",
    "projects": "projects",
    "project experience": "projects",
    "education": "education",
    "skills": "skills",
    "technical skills": "skills",
    "certifications": "certifications",
    "certificates": "certifications",
}


@bp.route("/profile", methods=["GET"])
def get_cv_profile():
    return jsonify(_get_or_create_profile())


@bp.route("/profile", methods=["PUT"])
def update_cv_profile():
    payload = require_object(request.get_json(silent=True))
    _get_or_create_profile()
    data = {
        "name": get_optional_string(payload, "name", max_length=160, default="") or "",
        "headline": get_optional_string(payload, "headline", max_length=200, default="") or "",
        "summary": get_optional_string(payload, "summary", max_length=4000, default="") or "",
        "email": get_optional_string(payload, "email", max_length=160, default="") or "",
        "phone": get_optional_string(payload, "phone", max_length=80, default="") or "",
        "location": get_optional_string(payload, "location", max_length=160, default="") or "",
        "links": get_optional_string(payload, "links", max_length=2000, default="") or "",
    }
    execute_db(
        """
        UPDATE cv_profiles
        SET name = ?, headline = ?, summary = ?, email = ?, phone = ?, location = ?, links = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
        """,
        (
            data["name"],
            data["headline"],
            data["summary"],
            data["email"],
            data["phone"],
            data["location"],
            data["links"],
        ),
    )
    return jsonify({"profile": _get_or_create_profile(), "message": "CV profile updated."})


@bp.route("/sections", methods=["GET"])
def get_cv_sections():
    return jsonify(_sections_with_items())


@bp.route("/sections", methods=["POST"])
def create_cv_section():
    payload = require_object(request.get_json(silent=True))
    data = _validate_section_payload(payload)
    section_id = execute_db(
        """
        INSERT INTO cv_sections (section_type, title, display_order, enabled, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (
            data["section_type"],
            data["title"],
            data["display_order"],
            data["enabled"],
        ),
    )
    _normalize_section_order()
    section = query_db("SELECT * FROM cv_sections WHERE id = ?", [section_id], one=True)
    return jsonify({"section": row_to_dict(section), "message": "CV section saved."}), 201


@bp.route("/sections/reorder", methods=["POST"])
def reorder_cv_sections():
    payload = require_object(request.get_json(silent=True))
    _apply_reorder("cv_sections", payload.get("ids"))
    return jsonify({"sections": _sections_with_items(), "message": "CV section order updated."})


@bp.route("/sections/<int:section_id>", methods=["PUT"])
def update_cv_section(section_id: int):
    row = query_db("SELECT * FROM cv_sections WHERE id = ?", [section_id], one=True)
    if not row:
        return jsonify({"error": "CV section not found."}), 404
    current = row_to_dict(row)
    data = _validate_section_payload({**current, **require_object(request.get_json(silent=True))})
    execute_db(
        """
        UPDATE cv_sections
        SET section_type = ?, title = ?, display_order = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (data["section_type"], data["title"], data["display_order"], data["enabled"], section_id),
    )
    _normalize_section_order()
    updated = query_db("SELECT * FROM cv_sections WHERE id = ?", [section_id], one=True)
    return jsonify({"section": row_to_dict(updated), "message": "CV section updated."})


@bp.route("/sections/<int:section_id>", methods=["DELETE"])
def delete_cv_section(section_id: int):
    row = query_db("SELECT id FROM cv_sections WHERE id = ?", [section_id], one=True)
    if not row:
        return jsonify({"error": "CV section not found."}), 404
    execute_db("DELETE FROM cv_sections WHERE id = ?", [section_id])
    _normalize_section_order()
    return jsonify({"message": "CV section deleted."})


@bp.route("/items", methods=["POST"])
def create_cv_item():
    payload = require_object(request.get_json(silent=True))
    data = _validate_item_payload(payload)
    item_id = execute_db(
        """
        INSERT INTO cv_items (
            section_id, title, organization, location, start_date, end_date, description,
            bullets, skills, display_order, enabled, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (
            data["section_id"],
            data["title"],
            data["organization"],
            data["location"],
            data["start_date"],
            data["end_date"],
            data["description"],
            data["bullets"],
            data["skills"],
            data["display_order"],
            data["enabled"],
        ),
    )
    _normalize_item_order(data["section_id"])
    item = query_db("SELECT * FROM cv_items WHERE id = ?", [item_id], one=True)
    return jsonify({"item": row_to_dict(item), "message": "CV item saved."}), 201


@bp.route("/items/reorder", methods=["POST"])
def reorder_cv_items():
    payload = require_object(request.get_json(silent=True))
    section_id = get_optional_int(payload, "section_id", minimum=1)
    if section_id is None:
        raise ValidationError("Section is required.", "section_id")
    _apply_reorder("cv_items", payload.get("ids"), where_clause="section_id = ?", where_args=[section_id])
    return jsonify({"sections": _sections_with_items(), "message": "CV item order updated."})


@bp.route("/items/<int:item_id>", methods=["PUT"])
def update_cv_item(item_id: int):
    row = query_db("SELECT * FROM cv_items WHERE id = ?", [item_id], one=True)
    if not row:
        return jsonify({"error": "CV item not found."}), 404
    current = row_to_dict(row)
    data = _validate_item_payload({**current, **require_object(request.get_json(silent=True))})
    execute_db(
        """
        UPDATE cv_items
        SET
            section_id = ?,
            title = ?,
            organization = ?,
            location = ?,
            start_date = ?,
            end_date = ?,
            description = ?,
            bullets = ?,
            skills = ?,
            display_order = ?,
            enabled = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
            data["section_id"],
            data["title"],
            data["organization"],
            data["location"],
            data["start_date"],
            data["end_date"],
            data["description"],
            data["bullets"],
            data["skills"],
            data["display_order"],
            data["enabled"],
            item_id,
        ),
    )
    _normalize_item_order(data["section_id"])
    updated = query_db("SELECT * FROM cv_items WHERE id = ?", [item_id], one=True)
    return jsonify({"item": row_to_dict(updated), "message": "CV item updated."})


@bp.route("/items/<int:item_id>", methods=["DELETE"])
def delete_cv_item(item_id: int):
    row = query_db("SELECT id, section_id FROM cv_items WHERE id = ?", [item_id], one=True)
    if not row:
        return jsonify({"error": "CV item not found."}), 404
    section_id = int(row["section_id"])
    execute_db("DELETE FROM cv_items WHERE id = ?", [item_id])
    _normalize_item_order(section_id)
    return jsonify({"message": "CV item deleted."})


@bp.route("/preview", methods=["GET"])
def get_cv_preview():
    payload = _cv_preview_payload()
    return jsonify(payload)


@bp.route("/import/pdf", methods=["POST"])
def import_cv_pdf():
    uploaded = request.files.get("file")
    if not uploaded:
        raise ValidationError("PDF file is required.", "file")
    if not uploaded.filename.lower().endswith(".pdf"):
        raise ValidationError("CV upload must be a PDF.", "file")

    try:
        reader = PdfReader(BytesIO(uploaded.read()))
        text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
    except Exception as exc:
        raise ValidationError("Unable to read text from this PDF.", "file") from exc

    if not text:
        raise ValidationError("No extractable text found in this PDF.", "file")

    parsed = _parse_cv_text(text)
    _replace_cv_from_parsed(parsed)
    return jsonify(
        {
            "message": "CV imported from PDF.",
            "profile": _get_or_create_profile(),
            "sections": _sections_with_items(),
            "raw_text": text[:6000],
        }
    )


@bp.route("/download", methods=["GET"])
def download_cv():
    fmt = request.args.get("format", "txt").strip().lower()
    payload = _cv_preview_payload()
    if fmt == "pdf":
        body = _render_cv_pdf(payload)
        return Response(
            body,
            mimetype="application/pdf",
            headers={"Content-Disposition": "attachment; filename=lifeos-cv.pdf"},
        )
    if fmt == "html":
        body = _render_cv_html(payload)
        return Response(
            body,
            mimetype="text/html",
            headers={"Content-Disposition": "attachment; filename=lifeos-cv.html"},
        )
    return Response(
        payload["text"],
        mimetype="text/plain",
        headers={"Content-Disposition": "attachment; filename=lifeos-cv.txt"},
    )


def _cv_preview_payload() -> dict:
    profile = _get_or_create_profile()
    sections = _sections_with_items(enabled_only=True)
    lines: list[str] = []
    if profile.get("name"):
        lines.append(profile["name"])
    if profile.get("headline"):
        lines.append(profile["headline"])

    contact = " | ".join(
        part
        for part in [profile.get("email"), profile.get("phone"), profile.get("location"), profile.get("links")]
        if part
    )
    if contact:
        lines.append(contact)
    if profile.get("summary"):
        lines.extend(["", "Summary", profile["summary"]])

    for section in sections:
        items = section.get("items") or []
        if not items:
            continue
        lines.extend(["", section["title"]])
        for item in items:
            heading = " - ".join(part for part in [item["title"], item.get("organization")] if part)
            dates = " to ".join(part for part in [item.get("start_date"), item.get("end_date")] if part)
            if dates:
                heading = f"{heading} ({dates})" if heading else dates
            if heading:
                lines.append(heading)
            if item.get("description"):
                lines.append(item["description"])
            for bullet in _split_lines(item.get("bullets")):
                lines.append(f"- {bullet}")
            if item.get("skills"):
                lines.append(f"Skills: {item['skills']}")

    return {"profile": profile, "sections": sections, "text": "\n".join(lines).strip()}


def _get_or_create_profile() -> dict:
    row = query_db("SELECT * FROM cv_profiles WHERE id = 1", one=True)
    if not row:
        execute_db("INSERT INTO cv_profiles (id) VALUES (1)")
        row = query_db("SELECT * FROM cv_profiles WHERE id = 1", one=True)
    return row_to_dict(row)


def _parse_cv_text(text: str) -> dict:
    lines = [line.strip() for line in text.replace("\r", "\n").splitlines() if line.strip()]
    if not lines:
        return {"profile": {}, "sections": []}

    email_match = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text)
    phone_match = re.search(r"(?:\+?\d[\d\s().-]{7,}\d)", text)
    links = re.findall(r"(?:https?://\S+|(?:www\.)\S+|(?:linkedin\.com|github\.com)/\S+)", text, flags=re.IGNORECASE)

    heading_indexes: list[tuple[int, str, str]] = []
    for index, line in enumerate(lines):
        normalized = re.sub(r"[^a-z ]", "", line.lower()).strip()
        if normalized in SECTION_ALIASES:
            section_type = SECTION_ALIASES[normalized]
            heading_indexes.append((index, section_type, line.title()))

    first_heading_index = heading_indexes[0][0] if heading_indexes else min(len(lines), 4)
    header_lines = lines[:first_heading_index]
    name = header_lines[0] if header_lines else lines[0]
    headline = ""
    for line in header_lines[1:]:
        if email_match and email_match.group(0) in line:
            continue
        if phone_match and phone_match.group(0) in line:
            continue
        if links and any(link in line for link in links):
            continue
        headline = line
        break

    sections = []
    if heading_indexes:
        for position, (start, section_type, title) in enumerate(heading_indexes):
            end = heading_indexes[position + 1][0] if position + 1 < len(heading_indexes) else len(lines)
            content = lines[start + 1:end]
            sections.append(_parse_cv_section(section_type, title, content))
    else:
        sections.append(_parse_cv_section("other", "Imported CV", lines[1:]))

    summary_section = next((section for section in sections if section["section_type"] == "summary"), None)
    summary = ""
    if summary_section and summary_section["items"]:
        summary = summary_section["items"][0]["description"] or summary_section["items"][0]["bullets"]
        sections = [section for section in sections if section is not summary_section]

    return {
        "profile": {
            "name": name,
            "headline": headline,
            "summary": summary,
            "email": email_match.group(0) if email_match else "",
            "phone": phone_match.group(0).strip() if phone_match else "",
            "location": "",
            "links": ", ".join(dict.fromkeys(links)),
        },
        "sections": [section for section in sections if section["items"]],
    }


def _parse_cv_section(section_type: str, title: str, lines: list[str]) -> dict:
    if section_type in {"skills", "summary"}:
        return {
            "section_type": section_type,
            "title": title,
            "items": [
                {
                    "title": title,
                    "organization": "",
                    "location": "",
                    "start_date": None,
                    "end_date": None,
                    "description": " ".join(lines) if section_type == "summary" else "",
                    "bullets": "\n".join(lines) if section_type == "skills" else "",
                    "skills": ", ".join(lines) if section_type == "skills" else "",
                }
            ]
            if lines
            else [],
        }

    items: list[dict] = []
    current: dict | None = None
    for line in lines:
        is_bullet = line.startswith(("-", "•", "*", "·"))
        cleaned = line.lstrip("-•*· ").strip()
        looks_like_heading = not is_bullet and (
            not current
            or bool(re.search(r"\b(19|20)\d{2}\b|present|current", line, flags=re.IGNORECASE))
            or len(cleaned.split()) <= 8
        )
        if looks_like_heading:
            current = {
                "title": cleaned,
                "organization": "",
                "location": "",
                "start_date": None,
                "end_date": None,
                "description": "",
                "bullets": "",
                "skills": "",
            }
            items.append(current)
            continue
        if not current:
            current = {
                "title": title,
                "organization": "",
                "location": "",
                "start_date": None,
                "end_date": None,
                "description": "",
                "bullets": "",
                "skills": "",
            }
            items.append(current)
        if is_bullet:
            current["bullets"] = "\n".join(part for part in [current["bullets"], cleaned] if part)
        else:
            current["description"] = " ".join(part for part in [current["description"], cleaned] if part)

    return {"section_type": section_type, "title": title, "items": items}


def _replace_cv_from_parsed(parsed: dict) -> None:
    profile = parsed.get("profile") or {}
    _get_or_create_profile()
    execute_db(
        """
        UPDATE cv_profiles
        SET name = ?, headline = ?, summary = ?, email = ?, phone = ?, location = ?, links = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
        """,
        (
            profile.get("name") or "",
            profile.get("headline") or "",
            profile.get("summary") or "",
            profile.get("email") or "",
            profile.get("phone") or "",
            profile.get("location") or "",
            profile.get("links") or "",
        ),
    )
    execute_db("DELETE FROM cv_items")
    execute_db("DELETE FROM cv_sections")

    for section_index, section in enumerate(parsed.get("sections") or [], start=1):
        section_id = execute_db(
            """
            INSERT INTO cv_sections (section_type, title, display_order, enabled, updated_at)
            VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
            """,
            (section.get("section_type") or "other", section.get("title") or "Imported Section", section_index),
        )
        for item_index, item in enumerate(section.get("items") or [], start=1):
            execute_db(
                """
                INSERT INTO cv_items (
                    section_id, title, organization, location, start_date, end_date, description,
                    bullets, skills, display_order, enabled, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
                """,
                (
                    section_id,
                    item.get("title") or section.get("title") or "Imported Item",
                    item.get("organization") or "",
                    item.get("location") or "",
                    item.get("start_date"),
                    item.get("end_date"),
                    item.get("description") or "",
                    item.get("bullets") or "",
                    item.get("skills") or "",
                    item_index,
                ),
            )


def _render_cv_html(payload: dict) -> str:
    escaped_text = (
        payload["text"]
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    return f"""<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\">
  <title>LifeOS CV</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 40px; line-height: 1.45; color: #111; }}
    pre {{ white-space: pre-wrap; font-family: inherit; }}
  </style>
</head>
<body><pre>{escaped_text}</pre></body>
</html>"""


def _render_cv_pdf(payload: dict) -> bytes:
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="LifeOS CV",
    )
    base_styles = getSampleStyleSheet()
    styles = {
        "name": ParagraphStyle(
            "LifeOSName",
            parent=base_styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=20,
            leading=24,
            spaceAfter=4,
            textColor=colors.HexColor("#111111"),
        ),
        "meta": ParagraphStyle(
            "LifeOSMeta",
            parent=base_styles["BodyText"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            spaceAfter=8,
            textColor=colors.HexColor("#333333"),
        ),
        "section": ParagraphStyle(
            "LifeOSSection",
            parent=base_styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            spaceBefore=10,
            spaceAfter=5,
            textColor=colors.HexColor("#111111"),
        ),
        "item": ParagraphStyle(
            "LifeOSItem",
            parent=base_styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=13,
            spaceBefore=4,
            spaceAfter=2,
            textColor=colors.HexColor("#111111"),
        ),
        "body": ParagraphStyle(
            "LifeOSBody",
            parent=base_styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=12.5,
            spaceAfter=3,
            textColor=colors.HexColor("#222222"),
        ),
        "bullet": ParagraphStyle(
            "LifeOSBullet",
            parent=base_styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=12.5,
            leftIndent=10,
            firstLineIndent=-6,
            bulletIndent=0,
            spaceAfter=2,
            textColor=colors.HexColor("#222222"),
        ),
    }
    story = []
    profile = payload["profile"]
    if profile.get("name"):
        story.append(Paragraph(_escape_pdf_text(profile["name"]), styles["name"]))
    if profile.get("headline"):
        story.append(Paragraph(_escape_pdf_text(profile["headline"]), styles["meta"]))
    contact = " | ".join(
        part
        for part in [profile.get("email"), profile.get("phone"), profile.get("location"), profile.get("links")]
        if part
    )
    if contact:
        story.append(Paragraph(_escape_pdf_text(contact), styles["meta"]))
    if profile.get("summary"):
        story.append(Paragraph("Summary", styles["section"]))
        story.append(Paragraph(_escape_pdf_text(profile["summary"]), styles["body"]))

    for section in payload["sections"]:
        items = section.get("items") or []
        if not items:
            continue
        story.append(Paragraph(_escape_pdf_text(section["title"]), styles["section"]))
        for item in items:
            heading = " - ".join(part for part in [item.get("title"), item.get("organization")] if part)
            dates = " to ".join(part for part in [item.get("start_date"), item.get("end_date")] if part)
            if dates:
                heading = f"{heading} ({dates})" if heading else dates
            if heading:
                story.append(Paragraph(_escape_pdf_text(heading), styles["item"]))
            if item.get("description"):
                story.append(Paragraph(_escape_pdf_text(item["description"]), styles["body"]))
            for bullet in _split_lines(item.get("bullets")):
                story.append(Paragraph(_escape_pdf_text(bullet), styles["bullet"], bulletText="•"))
            if item.get("skills"):
                story.append(Paragraph(f"Skills: {_escape_pdf_text(item['skills'])}", styles["body"]))
        story.append(Spacer(1, 2))

    document.build(story or [Paragraph("LifeOS CV", styles["name"])])
    return buffer.getvalue()


def _escape_pdf_text(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )


def _sections_with_items(*, enabled_only: bool = False) -> list[dict]:
    filters = ["enabled = 1"] if enabled_only else []
    query = "SELECT * FROM cv_sections"
    if filters:
        query += f" WHERE {' AND '.join(filters)}"
    query += " ORDER BY display_order ASC, id ASC"
    sections = rows_to_dicts(query_db(query))
    for section in sections:
        item_filters = ["section_id = ?"]
        params: list[object] = [section["id"]]
        if enabled_only:
            item_filters.append("enabled = 1")
        section["items"] = rows_to_dicts(
            query_db(
                f"""
                SELECT *
                FROM cv_items
                WHERE {' AND '.join(item_filters)}
                ORDER BY display_order ASC, id ASC
                """,
                params,
            )
        )
    return sections


def _validate_section_payload(payload: dict) -> dict[str, object]:
    return {
        "section_type": get_optional_choice(payload, "section_type", allowed=SECTION_TYPES, default="other") or "other",
        "title": get_required_string(payload, "title", max_length=140),
        "display_order": get_optional_int(payload, "display_order", minimum=0) or _next_order("cv_sections"),
        "enabled": 1 if _optional_bool_flag(payload, "enabled", default=True) else 0,
    }


def _validate_item_payload(payload: dict) -> dict[str, object]:
    section_id = get_optional_int(payload, "section_id", minimum=1)
    if section_id is None:
        raise ValidationError("Section is required.", "section_id")
    if not query_db("SELECT id FROM cv_sections WHERE id = ?", [section_id], one=True):
        raise ValidationError("CV section not found.", "section_id", status_code=404)

    start_date = get_optional_date(payload, "start_date")
    end_date = get_optional_date(payload, "end_date")
    if start_date and end_date and end_date < start_date:
        raise ValidationError("End date cannot be before start date.", "end_date")

    return {
        "section_id": section_id,
        "title": get_required_string(payload, "title", max_length=180),
        "organization": get_optional_string(payload, "organization", max_length=180, default="") or "",
        "location": get_optional_string(payload, "location", max_length=160, default="") or "",
        "start_date": start_date,
        "end_date": end_date,
        "description": get_optional_string(payload, "description", max_length=4000, default="") or "",
        "bullets": get_optional_string(payload, "bullets", max_length=6000, default="") or "",
        "skills": get_optional_string(payload, "skills", max_length=1000, default="") or "",
        "display_order": get_optional_int(payload, "display_order", minimum=0) or _next_order("cv_items", "section_id = ?", [section_id]),
        "enabled": 1 if _optional_bool_flag(payload, "enabled", default=True) else 0,
    }


def _optional_bool_flag(payload: dict, field: str, *, default: bool = True) -> bool:
    value = payload.get(field, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in {0, 1}:
        return bool(value)
    return bool(get_optional_bool(payload, field, default=default))


def _next_order(table_name: str, where_clause: str = "", where_args: list[object] | None = None) -> int:
    query = f"SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM {table_name}"
    args = where_args or []
    if where_clause:
        query += f" WHERE {where_clause}"
    row = query_db(query, args, one=True)
    return int(row["next_order"] or 1)


def _apply_reorder(table_name: str, ids: object, *, where_clause: str = "", where_args: list[object] | None = None) -> None:
    if not isinstance(ids, list) or not ids:
        raise ValidationError("Ids must be a non-empty list.", "ids")
    normalized_ids = []
    for item in ids:
        try:
            normalized_ids.append(int(item))
        except (TypeError, ValueError) as exc:
            raise ValidationError("Ids must contain only integers.", "ids") from exc
    if len(set(normalized_ids)) != len(normalized_ids):
        raise ValidationError("Ids must be unique.", "ids")

    query = f"SELECT id FROM {table_name}"
    args = where_args or []
    if where_clause:
        query += f" WHERE {where_clause}"
    existing_ids = {int(row["id"]) for row in query_db(query, args)}
    if set(normalized_ids) != existing_ids:
        raise ValidationError("Ids must include every existing record exactly once.", "ids")
    for index, item_id in enumerate(normalized_ids, start=1):
        execute_db(f"UPDATE {table_name} SET display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (index, item_id))


def _normalize_section_order() -> None:
    rows = query_db("SELECT id, display_order FROM cv_sections ORDER BY display_order ASC, id ASC")
    for index, row in enumerate(rows, start=1):
        if int(row["display_order"] or 0) != index:
            execute_db("UPDATE cv_sections SET display_order = ? WHERE id = ?", (index, row["id"]))


def _normalize_item_order(section_id: int) -> None:
    rows = query_db(
        "SELECT id, display_order FROM cv_items WHERE section_id = ? ORDER BY display_order ASC, id ASC",
        [section_id],
    )
    for index, row in enumerate(rows, start=1):
        if int(row["display_order"] or 0) != index:
            execute_db("UPDATE cv_items SET display_order = ? WHERE id = ?", (index, row["id"]))


def _split_lines(value: str | None) -> list[str]:
    return [line.strip().lstrip("- ").strip() for line in str(value or "").splitlines() if line.strip()]
