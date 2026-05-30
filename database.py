from __future__ import annotations

import sqlite3
from pathlib import Path

from flask import current_app, g


MIGRATIONS = (
    ("traits", "display_order", "ALTER TABLE traits ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0"),
    ("tasks", "completed_at", "ALTER TABLE tasks ADD COLUMN completed_at DATETIME"),
    ("projects", "completed_at", "ALTER TABLE projects ADD COLUMN completed_at DATETIME"),
    ("goals", "completed_at", "ALTER TABLE goals ADD COLUMN completed_at DATETIME"),
    ("goals", "notes", "ALTER TABLE goals ADD COLUMN notes TEXT"),
    ("notes", "tags", "ALTER TABLE notes ADD COLUMN tags TEXT DEFAULT ''"),
    ("notes", "is_pinned", "ALTER TABLE notes ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0"),
    ("journal_entries", "title", "ALTER TABLE journal_entries ADD COLUMN title TEXT DEFAULT ''"),
    ("journal_entries", "tags", "ALTER TABLE journal_entries ADD COLUMN tags TEXT DEFAULT ''"),
    ("journal_entries", "updated_at", "ALTER TABLE journal_entries ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP"),
    ("calendar_events", "project_id", "ALTER TABLE calendar_events ADD COLUMN project_id INTEGER"),
    ("calendar_events", "goal_id", "ALTER TABLE calendar_events ADD COLUMN goal_id INTEGER"),
    ("calendar_events", "recurrence", "ALTER TABLE calendar_events ADD COLUMN recurrence TEXT DEFAULT 'none'"),
    ("calendar_events", "recurrence_until", "ALTER TABLE calendar_events ADD COLUMN recurrence_until DATE"),
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
    _ensure_project_milestones_table(db)
    _ensure_goal_links_table(db)
    _ensure_goal_milestones_table(db)
    _ensure_life_tables(db)
    _ensure_calendar_relation_indexes(db)
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
    db.execute("UPDATE notes SET tags = COALESCE(tags, '')")
    db.execute("UPDATE journal_entries SET title = COALESCE(title, '')")
    db.execute("UPDATE journal_entries SET tags = COALESCE(tags, '')")
    db.execute("UPDATE journal_entries SET updated_at = COALESCE(updated_at, entry_date, CURRENT_TIMESTAMP)")
    if _column_exists(db, "traits", "display_order"):
        db.execute("UPDATE traits SET display_order = COALESCE(NULLIF(display_order, 0), id)")


def _ensure_project_milestones_table(db: sqlite3.Connection) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS project_milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            due_date DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS idx_project_milestones_project_id ON project_milestones(project_id)")


def _ensure_goal_links_table(db: sqlite3.Connection) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS goal_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS idx_goal_links_goal_id ON goal_links(goal_id)")


def _ensure_goal_milestones_table(db: sqlite3.Connection) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS goal_milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            due_date DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS idx_goal_milestones_goal_id ON goal_milestones(goal_id)")


def _ensure_life_tables(db: sqlite3.Connection) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS health_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            log_date DATE NOT NULL,
            sleep_hours REAL,
            weight_kg REAL,
            exercise_minutes INTEGER,
            energy_score INTEGER,
            symptoms TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS finance_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_date DATE NOT NULL,
            type TEXT NOT NULL,
            category TEXT,
            amount REAL NOT NULL,
            description TEXT,
            is_recurring INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            relation TEXT,
            priority TEXT DEFAULT 'normal',
            last_contacted DATE,
            next_follow_up DATE,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS life_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            period_type TEXT NOT NULL,
            period_start DATE NOT NULL,
            score INTEGER,
            wins TEXT,
            challenges TEXT,
            next_focus TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(period_type, period_start)
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_id INTEGER,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS idx_health_logs_date ON health_logs(log_date DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_finance_entries_date ON finance_entries(entry_date DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_contacts_follow_up ON contacts(next_follow_up)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_life_reviews_period ON life_reviews(period_type, period_start DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id)")


def _ensure_calendar_relation_indexes(db: sqlite3.Connection) -> None:
    if _column_exists(db, "calendar_events", "project_id"):
        db.execute("CREATE INDEX IF NOT EXISTS idx_calendar_events_project_id ON calendar_events(project_id)")
    if _column_exists(db, "calendar_events", "goal_id"):
        db.execute("CREATE INDEX IF NOT EXISTS idx_calendar_events_goal_id ON calendar_events(goal_id)")


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
