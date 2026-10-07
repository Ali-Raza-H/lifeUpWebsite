from __future__ import annotations

from functools import wraps
import hashlib
import secrets
from typing import Callable

import click
from flask import current_app, g, jsonify, request

from database import execute_db, query_db


DEFAULT_ASSISTANT_SCOPES = (
    "lifeos:read",
    "lifeos:write",
    "events:read",
    "events:ack",
)

KNOWN_ASSISTANT_SCOPES = {
    "lifeos:read": "Read planning, tasks, projects, goals, habits, calendar, notes, and library data.",
    "lifeos:write": "Create and update non-destructive LifeOS records.",
    "tasks:read": "Read tasks without access to other LifeOS domains.",
    "tasks:write": "Create and update tasks without access to other LifeOS domains.",
    "focus:read": "Read focus-session time entries.",
    "focus:write": "Create and update focus-session time entries.",
    "external:send": "Send external messages, including LinkedIn drafts.",
    "admin:maintenance": "Run destructive LifeOS maintenance and profile operations.",
    "events:read": "Poll or stream assistant notifications; sensitive event content also requires its data scope.",
    "events:ack": "Acknowledge assistant notifications.",
    "sensitive:contacts": "Read and update contact details and follow-ups.",
    "sensitive:journal": "Read and create journal entries.",
    "sensitive:health": "Read and create health, diet, and gym logs.",
    "sensitive:finance": "Read, create, and update finance entries.",
    "*": "All current and future assistant scopes.",
}


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _normalize_scopes(scopes: str | list[str] | tuple[str, ...]) -> tuple[str, ...]:
    values = scopes.split(",") if isinstance(scopes, str) else scopes
    normalized = tuple(dict.fromkeys(str(scope).strip() for scope in values if str(scope).strip()))
    unknown = sorted(set(normalized) - set(KNOWN_ASSISTANT_SCOPES))
    if unknown:
        raise ValueError(f"Unknown assistant scope(s): {', '.join(unknown)}")
    if not normalized:
        raise ValueError("At least one assistant scope is required.")
    return normalized


def create_assistant_key(
    name: str,
    scopes: str | list[str] | tuple[str, ...] = DEFAULT_ASSISTANT_SCOPES,
    *,
    raw_key: str | None = None,
) -> tuple[str, dict]:
    clean_name = str(name or "").strip()
    if not clean_name:
        raise ValueError("Assistant key name is required.")
    normalized_scopes = _normalize_scopes(scopes)
    secret = raw_key or f"lifeos_{secrets.token_urlsafe(32)}"
    key_hash = _hash_key(secret)
    existing = query_db("SELECT id FROM assistant_api_keys WHERE key_hash = ?", [key_hash], one=True)
    if existing:
        execute_db(
            "UPDATE assistant_api_keys SET name = ?, scopes = ?, revoked_at = NULL WHERE id = ?",
            (clean_name, ",".join(normalized_scopes), existing["id"]),
        )
        key_id = int(existing["id"])
    else:
        key_id = execute_db(
            """
            INSERT INTO assistant_api_keys (name, key_hash, key_prefix, scopes)
            VALUES (?, ?, ?, ?)
            """,
            (clean_name, key_hash, secret[:14], ",".join(normalized_scopes)),
        )
    return secret, {
        "id": key_id,
        "name": clean_name,
        "key_prefix": secret[:14],
        "scopes": list(normalized_scopes),
    }


def authenticate_assistant_request():
    authorization = request.headers.get("Authorization", "")
    scheme, _, raw_key = authorization.partition(" ")
    if scheme.lower() != "bearer" or not raw_key.strip():
        return jsonify({"error": "assistant_authentication_required", "message": "A Bearer API key is required."}), 401

    key_hash = _hash_key(raw_key.strip())
    key_row = query_db(
        """
        SELECT id, name, key_prefix, scopes
        FROM assistant_api_keys
        WHERE key_hash = ? AND revoked_at IS NULL
        """,
        [key_hash],
        one=True,
    )
    if not key_row:
        return jsonify({"error": "invalid_assistant_api_key", "message": "The assistant API key is invalid or revoked."}), 401

    g.assistant_api_key = dict(key_row)
    g.assistant_scopes = {scope for scope in str(key_row["scopes"] or "").split(",") if scope}
    execute_db("UPDATE assistant_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?", [key_row["id"]])
    return None


def require_assistant_scopes(*required_scopes: str):
    def decorator(function: Callable):
        @wraps(function)
        def wrapped(*args, **kwargs):
            granted = getattr(g, "assistant_scopes", set())
            missing = [scope for scope in required_scopes if "*" not in granted and scope not in granted]
            if missing:
                return (
                    jsonify(
                        {
                            "error": "insufficient_scope",
                            "message": "The API key does not grant the required scope.",
                            "required_scopes": list(required_scopes),
                            "missing_scopes": missing,
                        }
                    ),
                    403,
                )
            return function(*args, **kwargs)

        return wrapped

    return decorator


def _bootstrap_environment_key(app) -> None:
    raw_key = str(app.config.get("ASSISTANT_API_KEY") or "").strip()
    if not raw_key:
        return
    scopes = str(app.config.get("ASSISTANT_API_KEY_SCOPES") or ",".join(DEFAULT_ASSISTANT_SCOPES))
    name = str(app.config.get("ASSISTANT_API_KEY_NAME") or "Environment key")
    with app.app_context():
        create_assistant_key(name, scopes, raw_key=raw_key)


def register_assistant_key_cli(app) -> None:
    @app.cli.command("assistant-key-create")
    @click.option("--name", required=True, help="Human-readable key name, for example CIEL.")
    @click.option(
        "--scopes",
        default=",".join(DEFAULT_ASSISTANT_SCOPES),
        show_default=True,
        help="Comma-separated assistant scopes.",
    )
    def assistant_key_create(name: str, scopes: str):
        """Create an assistant API key and print its secret once."""
        secret, record = create_assistant_key(name, scopes)
        click.echo(f"Created assistant key {record['name']} ({record['key_prefix']}...).")
        click.echo(f"Scopes: {', '.join(record['scopes'])}")
        click.echo(f"Secret (store it now): {secret}")

    @app.cli.command("assistant-key-list")
    def assistant_key_list():
        """List assistant API keys without revealing secrets."""
        rows = query_db(
            """
            SELECT id, name, key_prefix, scopes, created_at, last_used_at, revoked_at
            FROM assistant_api_keys
            ORDER BY created_at DESC, id DESC
            """
        )
        if not rows:
            click.echo("No assistant API keys configured.")
            return
        for row in rows:
            state = "revoked" if row["revoked_at"] else "active"
            click.echo(f"{row['id']}: {row['name']} [{state}] {row['key_prefix']}... ({row['scopes']})")

    @app.cli.command("assistant-key-revoke")
    @click.argument("key_id", type=int)
    def assistant_key_revoke(key_id: int):
        """Revoke an assistant API key by numeric ID."""
        row = query_db("SELECT id, name FROM assistant_api_keys WHERE id = ?", [key_id], one=True)
        if not row:
            raise click.ClickException("Assistant API key not found.")
        execute_db("UPDATE assistant_api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?", [key_id])
        click.echo(f"Revoked assistant key {row['name']} ({key_id}).")


def init_assistant_auth(app) -> None:
    register_assistant_key_cli(app)
    _bootstrap_environment_key(app)
