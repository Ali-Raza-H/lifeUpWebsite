from __future__ import annotations

import sqlite3
from pathlib import Path

from flask import current_app, g


DEFAULT_FOOD_PRESETS = (
    ("Pakistani Staples", "Roti", "1 medium", 120, 3.8, 22, 1.2, 1),
    ("Pakistani Staples", "Paratha", "1 plain paratha", 300, 7, 39, 12, 2),
    ("Pakistani Staples", "Naan", "1 naan", 260, 8, 50, 4, 3),
    ("Pakistani Staples", "Basmati Rice", "1 cup cooked", 205, 4.3, 45, 0.4, 4),
    ("Protein & Basics", "White Rice", "100 g cooked", 130, 2.7, 28, 0.3, 5),
    ("Pakistani Staples", "Chai", "1 mug with milk and sugar", 120, 3, 18, 4, 6),
    ("Pakistani Mains", "Daal", "1 cup cooked", 230, 18, 40, 1, 7),
    ("Pakistani Mains", "Chicken Curry", "1 cup", 280, 26, 8, 16, 8),
    ("Pakistani Mains", "Keema Curry", "1 cup", 320, 23, 9, 22, 9),
    ("Pakistani Mains", "Seekh Kebab", "2 kebabs", 220, 20, 5, 14, 10),
    ("Pakistani Snacks", "Samosa", "1 medium", 260, 5, 27, 14, 11),
    ("Pakistani Snacks", "Pakora", "3 pieces", 220, 5, 18, 14, 12),
    ("Protein & Basics", "Chicken Breast", "100 g", 165, 31, 0, 3.6, 13),
    ("Protein & Basics", "Eggs", "2 large eggs", 140, 12, 1, 10, 14),
    ("Protein & Basics", "Whey Protein", "1 scoop", 120, 24, 3, 1.5, 15),
    ("Protein & Basics", "Salmon", "100 g", 208, 20, 0, 13, 16),
    ("Breakfast & Dairy", "Oats", "50 g", 190, 6.5, 33, 3.5, 17),
    ("Breakfast & Dairy", "Greek Yogurt", "170 g pot", 100, 17, 6, 0, 18),
    ("Breakfast & Dairy", "Whole Milk", "250 ml", 155, 8, 12, 8.5, 19),
    ("Breakfast & Dairy", "Wholemeal Bread", "2 slices", 190, 8, 30, 2.5, 20),
    ("Fruit & Quick Bits", "Banana", "1 medium", 105, 1.3, 27, 0.3, 21),
    ("Fruit & Quick Bits", "Peanut Butter", "1 tbsp", 95, 4, 3, 8, 22),
    ("Fruit & Quick Bits", "Pasta", "100 g cooked", 157, 5.8, 31, 0.9, 23),
    ("Drinks", "Monster Energy Original", "1 can (500 ml)", 237, 0, 60, 0, 24),
    ("Corner Shop Crisps", "Cheetos Twisted Sweet & Spicy Flamin' Hot", "1 grab bag (38 g)", 203, 2.1, 23, 11, 25),
    ("Corner Shop Crisps", "Golden Cross Party Mix Sea Salt & Black Pepper", "1 serving (25 g)", 115, 1, 17.5, 4.7, 26),
    ("Chocolate & Sweets", "Snickers Duo", "1 bar (41.7 g)", 215, 4, 22, 12, 27),
    ("Chocolate & Sweets", "Reese's Big Cup King Size", "1 pack (78 g)", 400, 9, 45, 23, 28),
)


MIGRATIONS = (
    ("traits", "display_order", "ALTER TABLE traits ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0"),
    ("tasks", "completed_at", "ALTER TABLE tasks ADD COLUMN completed_at DATETIME"),
    ("tasks", "calendar_event_id", "ALTER TABLE tasks ADD COLUMN calendar_event_id INTEGER"),
    ("tasks", "linkedin_post_enabled", "ALTER TABLE tasks ADD COLUMN linkedin_post_enabled INTEGER NOT NULL DEFAULT 0"),
    ("projects", "completed_at", "ALTER TABLE projects ADD COLUMN completed_at DATETIME"),
    ("projects", "linkedin_post_enabled", "ALTER TABLE projects ADD COLUMN linkedin_post_enabled INTEGER NOT NULL DEFAULT 0"),
    ("goals", "completed_at", "ALTER TABLE goals ADD COLUMN completed_at DATETIME"),
    ("goals", "notes", "ALTER TABLE goals ADD COLUMN notes TEXT"),
    ("notes", "tags", "ALTER TABLE notes ADD COLUMN tags TEXT DEFAULT ''"),
    ("notes", "is_pinned", "ALTER TABLE notes ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0"),
    ("journal_entries", "title", "ALTER TABLE journal_entries ADD COLUMN title TEXT DEFAULT ''"),
    ("journal_entries", "tags", "ALTER TABLE journal_entries ADD COLUMN tags TEXT DEFAULT ''"),
    ("journal_entries", "ai_feedback", "ALTER TABLE journal_entries ADD COLUMN ai_feedback TEXT DEFAULT ''"),
    ("journal_entries", "ai_feedback_generated_at", "ALTER TABLE journal_entries ADD COLUMN ai_feedback_generated_at DATETIME"),
    ("journal_entries", "ai_feedback_model", "ALTER TABLE journal_entries ADD COLUMN ai_feedback_model TEXT DEFAULT ''"),
    ("journal_entries", "updated_at", "ALTER TABLE journal_entries ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP"),
    ("calendar_events", "project_id", "ALTER TABLE calendar_events ADD COLUMN project_id INTEGER"),
    ("calendar_events", "goal_id", "ALTER TABLE calendar_events ADD COLUMN goal_id INTEGER"),
    ("calendar_events", "recurrence", "ALTER TABLE calendar_events ADD COLUMN recurrence TEXT DEFAULT 'none'"),
    ("calendar_events", "recurrence_until", "ALTER TABLE calendar_events ADD COLUMN recurrence_until DATE"),
    ("food_presets", "category", "ALTER TABLE food_presets ADD COLUMN category TEXT NOT NULL DEFAULT 'Uncategorized'"),
    ("diet_entries", "category", "ALTER TABLE diet_entries ADD COLUMN category TEXT DEFAULT ''"),
    ("attachments", "is_favorite", "ALTER TABLE attachments ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0"),
)


def get_db() -> sqlite3.Connection:
    db = g.get("db")
    if db is None:
        database_path = current_app.config["DATABASE"]
        Path(database_path).parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(database_path)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("PRAGMA busy_timeout = 5000")
        db.execute("PRAGMA temp_store = MEMORY")
        db.execute("PRAGMA cache_size = -8192")
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
    _ensure_notebook_tables(db)
    _ensure_goal_links_table(db)
    _ensure_goal_milestones_table(db)
    _ensure_life_tables(db)
    _ensure_library_tables(db)
    _ensure_work_tables(db)
    _ensure_linkedin_tables(db)
    _ensure_calendar_relation_indexes(db)
    _ensure_task_sync_indexes(db)
    _sync_project_notebook_folders(db)
    _backfill_project_notes_to_folder_notes(db)
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
    db.execute("UPDATE notes SET tags = '' WHERE tags IS NULL")
    db.execute("UPDATE journal_entries SET title = '' WHERE title IS NULL")
    db.execute("UPDATE journal_entries SET tags = '' WHERE tags IS NULL")
    if _column_exists(db, "journal_entries", "ai_feedback"):
        db.execute("UPDATE journal_entries SET ai_feedback = '' WHERE ai_feedback IS NULL")
    if _column_exists(db, "journal_entries", "ai_feedback_model"):
        db.execute("UPDATE journal_entries SET ai_feedback_model = '' WHERE ai_feedback_model IS NULL")
    if _column_exists(db, "attachments", "is_favorite"):
        db.execute("UPDATE attachments SET is_favorite = 0 WHERE is_favorite IS NULL")
    db.execute(
        """
        UPDATE journal_entries
        SET updated_at = COALESCE(entry_date, CURRENT_TIMESTAMP)
        WHERE updated_at IS NULL
        """
    )
    if _column_exists(db, "traits", "display_order"):
        db.execute("UPDATE traits SET display_order = id WHERE display_order IS NULL OR display_order = 0")


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


def _ensure_notebook_tables(db: sqlite3.Connection) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS notebook_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            folder_type TEXT NOT NULL DEFAULT 'Personal',
            project_id INTEGER UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS folder_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            legacy_project_note_id INTEGER UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (folder_id) REFERENCES notebook_folders(id) ON DELETE CASCADE
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS notebooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER,
            title TEXT NOT NULL,
            is_main INTEGER NOT NULL DEFAULT 0,
            display_order INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (folder_id) REFERENCES notebook_folders(id) ON DELETE CASCADE
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS notebook_pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            notebook_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            page_number INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
        )
        """
    )
    if not _column_exists(db, "folder_notes", "legacy_project_note_id"):
        db.execute("ALTER TABLE folder_notes ADD COLUMN legacy_project_note_id INTEGER")
    if not _column_exists(db, "notebooks", "is_main"):
        db.execute("ALTER TABLE notebooks ADD COLUMN is_main INTEGER NOT NULL DEFAULT 0")
    if _notebooks_folder_id_is_required(db):
        _make_notebooks_folder_id_nullable(db)
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_notebook_folders_project_id ON notebook_folders(project_id)")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_notes_legacy_project_note_id ON folder_notes(legacy_project_note_id)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_notebook_folders_type ON notebook_folders(folder_type, name)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_folder_notes_folder_id ON folder_notes(folder_id, updated_at DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_notebooks_folder_id ON notebooks(folder_id, display_order, id)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_notebooks_root ON notebooks(display_order, id) WHERE folder_id IS NULL")
    db.execute("CREATE INDEX IF NOT EXISTS idx_notebook_pages_notebook_id ON notebook_pages(notebook_id, page_number, id)")


def _notebooks_folder_id_is_required(db: sqlite3.Connection) -> bool:
    rows = db.execute("PRAGMA table_info(notebooks)").fetchall()
    for row in rows:
        if row["name"] == "folder_id":
            return bool(row["notnull"])
    return False


def _make_notebooks_folder_id_nullable(db: sqlite3.Connection) -> None:
    db.execute("PRAGMA foreign_keys = OFF")
    db.execute("ALTER TABLE notebooks RENAME TO notebooks_old")
    db.execute("ALTER TABLE notebook_pages RENAME TO notebook_pages_old")
    db.execute(
        """
        CREATE TABLE notebooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER,
            title TEXT NOT NULL,
            is_main INTEGER NOT NULL DEFAULT 0,
            display_order INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (folder_id) REFERENCES notebook_folders(id) ON DELETE CASCADE
        )
        """
    )
    db.execute(
        """
        CREATE TABLE notebook_pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            notebook_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            page_number INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
        )
        """
    )
    db.execute(
        """
        INSERT INTO notebooks (id, folder_id, title, is_main, display_order, created_at, updated_at)
        SELECT id, folder_id, title, is_main, display_order, created_at, updated_at
        FROM notebooks_old
        """
    )
    db.execute(
        """
        INSERT INTO notebook_pages (id, notebook_id, title, content, page_number, created_at, updated_at)
        SELECT id, notebook_id, title, content, page_number, created_at, updated_at
        FROM notebook_pages_old
        """
    )
    db.execute("DROP TABLE notebook_pages_old")
    db.execute("DROP TABLE notebooks_old")
    db.execute("PRAGMA foreign_keys = ON")


def ensure_project_notebook_folder(project_id: int, project_name: str) -> int:
    db = get_db()
    return _ensure_project_notebook_folder(db, project_id, project_name)


def _ensure_project_notebook_folder(db: sqlite3.Connection, project_id: int, project_name: str) -> int:
    existing = db.execute("SELECT id FROM notebook_folders WHERE project_id = ?", (project_id,)).fetchone()
    if existing:
        db.execute(
            "UPDATE notebook_folders SET name = ?, folder_type = 'Projects', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (project_name, existing["id"]),
        )
        return int(existing["id"])
    cur = db.execute(
        "INSERT INTO notebook_folders (name, folder_type, project_id) VALUES (?, 'Projects', ?)",
        (project_name, project_id),
    )
    return int(cur.lastrowid)


def _sync_project_notebook_folders(db: sqlite3.Connection) -> None:
    projects = db.execute("SELECT id, name FROM projects ORDER BY id ASC").fetchall()
    for project in projects:
        _ensure_project_notebook_folder(db, int(project["id"]), project["name"])


def _backfill_project_notes_to_folder_notes(db: sqlite3.Connection) -> None:
    rows = db.execute(
        """
        SELECT pn.id, pn.project_id, pn.title, pn.content, pn.created_at, pn.updated_at, p.name AS project_name
        FROM project_notes pn
        JOIN projects p ON p.id = pn.project_id
        ORDER BY pn.project_id ASC, pn.id ASC
        """
    ).fetchall()
    for row in rows:
        folder_id = _ensure_project_notebook_folder(db, int(row["project_id"]), row["project_name"])
        exists = db.execute(
            "SELECT id FROM folder_notes WHERE legacy_project_note_id = ?",
            (row["id"],),
        ).fetchone()
        if exists:
            continue
        db.execute(
            """
            INSERT INTO folder_notes (folder_id, title, content, legacy_project_note_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (folder_id, row["title"], row["content"], row["id"], row["created_at"], row["updated_at"]),
        )


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
            is_favorite INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS food_presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'Uncategorized',
            serving_label TEXT NOT NULL,
            calories REAL NOT NULL DEFAULT 0,
            protein_g REAL NOT NULL DEFAULT 0,
            carbs_g REAL NOT NULL DEFAULT 0,
            fat_g REAL NOT NULL DEFAULT 0,
            display_order INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS diet_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_date DATE NOT NULL,
            preset_id INTEGER NOT NULL,
            food_name TEXT NOT NULL,
            category TEXT DEFAULT '',
            serving_label TEXT NOT NULL,
            meal_type TEXT NOT NULL DEFAULT 'snack',
            servings REAL NOT NULL DEFAULT 1,
            calories REAL NOT NULL DEFAULT 0,
            protein_g REAL NOT NULL DEFAULT 0,
            carbs_g REAL NOT NULL DEFAULT 0,
            fat_g REAL NOT NULL DEFAULT 0,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (preset_id) REFERENCES food_presets(id) ON DELETE RESTRICT
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS idx_health_logs_date ON health_logs(log_date DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_finance_entries_date ON finance_entries(entry_date DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_contacts_follow_up ON contacts(next_follow_up)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_life_reviews_period ON life_reviews(period_type, period_start DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_attachments_favorite ON attachments(is_favorite, created_at DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_food_presets_order ON food_presets(display_order, name)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_diet_entries_date ON diet_entries(entry_date DESC, meal_type, id DESC)")
    _seed_food_presets(db)


def _seed_food_presets(db: sqlite3.Connection) -> None:
    for category, name, serving_label, calories, protein_g, carbs_g, fat_g, display_order in DEFAULT_FOOD_PRESETS:
        existing = db.execute(
            """
            SELECT id, category, calories, protein_g, carbs_g, fat_g, display_order
            FROM food_presets
            WHERE name = ? AND serving_label = ?
            LIMIT 1
            """,
            (name, serving_label),
        ).fetchone()

        if existing:
            current_values = (
                existing["category"],
                float(existing["calories"] or 0),
                float(existing["protein_g"] or 0),
                float(existing["carbs_g"] or 0),
                float(existing["fat_g"] or 0),
                int(existing["display_order"] or 0),
            )
            desired_values = (
                category,
                float(calories),
                float(protein_g),
                float(carbs_g),
                float(fat_g),
                int(display_order),
            )
            if current_values == desired_values:
                continue

            db.execute(
                """
                UPDATE food_presets
                SET
                    category = ?,
                    calories = ?,
                    protein_g = ?,
                    carbs_g = ?,
                    fat_g = ?,
                    display_order = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (category, calories, protein_g, carbs_g, fat_g, display_order, existing["id"]),
            )
            continue

        db.execute(
            """
            INSERT INTO food_presets (
                name, category, serving_label, calories, protein_g, carbs_g, fat_g, display_order, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (name, category, serving_label, calories, protein_g, carbs_g, fat_g, display_order),
        )


def _ensure_library_tables(db: sqlite3.Connection) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS media_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            media_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'want_to_start',
            creator TEXT,
            platform TEXT,
            current_unit INTEGER,
            total_units INTEGER,
            score INTEGER,
            started_on DATE,
            completed_on DATE,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS idx_media_items_type_status ON media_items(media_type, status, updated_at DESC)")


def _ensure_work_tables(db: sqlite3.Connection) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS work_experiences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            organization TEXT NOT NULL,
            experience_type TEXT NOT NULL DEFAULT 'job',
            status TEXT NOT NULL DEFAULT 'saved',
            location TEXT,
            start_date DATE,
            end_date DATE,
            hours_per_week INTEGER,
            skills TEXT DEFAULT '',
            responsibilities TEXT DEFAULT '',
            achievements TEXT DEFAULT '',
            application_url TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS idx_work_experiences_status ON work_experiences(status, updated_at DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_work_experiences_dates ON work_experiences(start_date DESC, end_date DESC)")


def _ensure_linkedin_tables(db: sqlite3.Connection) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS linkedin_drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_type TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            post_body TEXT NOT NULL,
            context_summary TEXT DEFAULT '',
            email_to TEXT NOT NULL,
            email_status TEXT NOT NULL DEFAULT 'pending',
            email_error TEXT DEFAULT '',
            sent_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(source_type, source_id)
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_drafts_status ON linkedin_drafts(email_status, created_at DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_linkedin_drafts_source ON linkedin_drafts(source_type, source_id)")


def _ensure_calendar_relation_indexes(db: sqlite3.Connection) -> None:
    if _column_exists(db, "calendar_events", "project_id"):
        db.execute("CREATE INDEX IF NOT EXISTS idx_calendar_events_project_id ON calendar_events(project_id)")
    if _column_exists(db, "calendar_events", "goal_id"):
        db.execute("CREATE INDEX IF NOT EXISTS idx_calendar_events_goal_id ON calendar_events(goal_id)")


def _ensure_task_sync_indexes(db: sqlite3.Connection) -> None:
    if _column_exists(db, "tasks", "calendar_event_id"):
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_calendar_event_id ON tasks(calendar_event_id)")


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
