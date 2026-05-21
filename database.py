from __future__ import annotations

import sqlite3
from pathlib import Path

from flask import current_app, g


MIGRATIONS = (
    ("tasks", "completed_at", "ALTER TABLE tasks ADD COLUMN completed_at DATETIME"),
    ("projects", "completed_at", "ALTER TABLE projects ADD COLUMN completed_at DATETIME"),
    ("goals", "completed_at", "ALTER TABLE goals ADD COLUMN completed_at DATETIME"),
)


def get_db() -> sqlite3.Connection:
    db = g.get("db")
    if db is None:
        database_path = current_app.config["DATABASE"]
        Path(database_path).parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(database_path)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        g.db = db
    return db


def close_connection(_exception: Exception | None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    db = get_db()
    schema_path = Path(current_app.root_path) / "schema.sql"
    db.executescript(schema_path.read_text(encoding="utf-8"))
    _run_migrations(db)
    _backfill_completion_timestamps(db)
    db.commit()


def init_app(app) -> None:
    app.teardown_appcontext(close_connection)
    with app.app_context():
        init_db()


def _run_migrations(db: sqlite3.Connection) -> None:
    for table_name, column_name, statement in MIGRATIONS:
        if not _column_exists(db, table_name, column_name):
            db.execute(statement)


def _column_exists(db: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    rows = db.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row["name"] == column_name for row in rows)


def _backfill_completion_timestamps(db: sqlite3.Connection) -> None:
    db.execute(
        """
        UPDATE tasks
        SET completed_at = COALESCE(completed_at, created_at)
        WHERE status = 'completed' AND completed_at IS NULL
        """
    )
    db.execute(
        """
        UPDATE projects
        SET completed_at = COALESCE(completed_at, created_at)
        WHERE status = 'completed' AND completed_at IS NULL
        """
    )
    db.execute(
        """
        UPDATE goals
        SET completed_at = COALESCE(completed_at, created_at)
        WHERE status = 'completed' AND completed_at IS NULL
        """
    )


def query_db(query: str, args=(), one: bool = False):
    cur = get_db().execute(query, args)
    rows = cur.fetchall()
    cur.close()
    if one:
        return rows[0] if rows else None
    return rows


def execute_db(query: str, args=()) -> int:
    db = get_db()
    cur = db.cursor()
    cur.execute(query, args)
    db.commit()
    last_row_id = cur.lastrowid
    cur.close()
    return last_row_id
