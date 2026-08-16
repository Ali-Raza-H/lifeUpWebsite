from __future__ import annotations

import json
import uuid

from database import execute_db, query_db
from services import build_notifications_payload
from utils import iso_now, row_to_dict, rows_to_dicts


def _decode_event(row: dict) -> dict:
    event = dict(row)
    try:
        event["payload"] = json.loads(event.pop("payload_json") or "{}")
    except json.JSONDecodeError:
        event["payload"] = {}
        event.pop("payload_json", None)
    event["acknowledged"] = bool(event.get("acknowledged_at"))
    return event


def publish_assistant_event(
    event_type: str,
    title: str,
    *,
    message: str = "",
    severity: str = "low",
    source_type: str | None = None,
    source_id: int | None = None,
    payload: dict | None = None,
    event_key: str | None = None,
) -> int | None:
    key = event_key or f"{event_type}:{uuid.uuid4().hex}"
    event_id = execute_db(
        """
        INSERT OR IGNORE INTO assistant_events (
            event_key, event_type, severity, title, message, source_type, source_id, payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            key,
            event_type,
            severity if severity in {"low", "medium", "high"} else "low",
            title,
            message,
            source_type,
            source_id,
            json.dumps(payload or {}, separators=(",", ":")),
        ),
    )
    if not event_id:
        existing = query_db("SELECT id FROM assistant_events WHERE event_key = ?", [key], one=True)
        return int(existing["id"]) if existing else None
    return int(event_id)


def materialize_current_notifications() -> int:
    payload = build_notifications_payload(limit=100)
    created = 0
    for item in payload.get("items", []):
        event_key = f"{item['id']}:{item.get('when') or ''}"
        event_type = {
            "task": "task.attention_required",
            "event": "calendar.event_upcoming",
            "contact": "contact.followup_due",
        }.get(item.get("kind"), "lifeos.attention_required")
        before = query_db("SELECT id FROM assistant_events WHERE event_key = ?", [event_key], one=True)
        publish_assistant_event(
            event_type,
            item["title"],
            message=item.get("message") or "",
            severity=item.get("severity") or "low",
            source_type=item.get("source_type"),
            source_id=item.get("source_id"),
            payload={"when": item.get("when"), "action_url": item.get("action_url")},
            event_key=event_key,
        )
        if not before:
            created += 1
    return created


def list_assistant_events(
    *,
    after_id: int = 0,
    limit: int = 50,
    include_acknowledged: bool = False,
    exclude_source_types: tuple[str, ...] = (),
) -> list[dict]:
    filters = ["id > ?", "available_at <= ?"]
    params: list[object] = [max(0, after_id), iso_now()]
    if not include_acknowledged:
        filters.append("acknowledged_at IS NULL")
    if exclude_source_types:
        placeholders = ",".join("?" for _ in exclude_source_types)
        filters.append(f"COALESCE(source_type, '') NOT IN ({placeholders})")
        params.extend(exclude_source_types)
    params.append(max(1, min(limit, 200)))
    rows = rows_to_dicts(
        query_db(
            f"""
            SELECT *
            FROM assistant_events
            WHERE {' AND '.join(filters)}
            ORDER BY id ASC
            LIMIT ?
            """,
            params,
        )
    )
    return [_decode_event(row) for row in rows]


def acknowledge_assistant_event(event_id: int) -> dict | None:
    row = query_db("SELECT * FROM assistant_events WHERE id = ?", [event_id], one=True)
    if not row:
        return None
    execute_db(
        "UPDATE assistant_events SET acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP) WHERE id = ?",
        [event_id],
    )
    updated = query_db("SELECT * FROM assistant_events WHERE id = ?", [event_id], one=True)
    return _decode_event(row_to_dict(updated))
