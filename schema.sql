CREATE TABLE IF NOT EXISTS traits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 50, -- 0 to 100
    category TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS beliefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    proficiency INTEGER NOT NULL DEFAULT 50, -- 0 to 100
    experience_level TEXT DEFAULT 'intermediate',
    notes TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admired_people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role_or_context TEXT DEFAULT '',
    why_admired TEXT NOT NULL,
    traits_to_model TEXT DEFAULT '',
    reference_url TEXT DEFAULT '',
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    frequency TEXT DEFAULT 'daily', -- daily, weekly, monthly
    category TEXT,
    target_streak INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS habit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL,
    log_date DATE NOT NULL,
    status TEXT DEFAULT 'completed', -- completed, failed, skipped
    FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
    UNIQUE(habit_id, log_date)
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    priority INTEGER DEFAULT 3, -- 1: Highest, 2: High, 3: Normal, 4: Low
    due_date DATETIME,
    estimated_minutes INTEGER,
    status TEXT DEFAULT 'pending', -- pending, in_progress, on_hold, completed
    project_id INTEGER,
    goal_id INTEGER,
    calendar_event_id INTEGER,
    calendar_sync_enabled INTEGER NOT NULL DEFAULT 1,
    not_completed INTEGER NOT NULL DEFAULT 0,
    not_completed_at DATETIME,
    linkedin_post_enabled INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL,
    FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    notes TEXT,
    goal_id INTEGER,
    status TEXT DEFAULT 'planning', -- planning, active, paused, completed
    deadline DATETIME,
    linkedin_post_enabled INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS project_habits (
    project_id INTEGER NOT NULL,
    habit_id INTEGER NOT NULL,
    PRIMARY KEY (project_id, habit_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notebook_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    folder_type TEXT NOT NULL DEFAULT 'Personal',
    project_id INTEGER UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS folder_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    legacy_project_note_id INTEGER UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES notebook_folders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notebooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER,
    title TEXT NOT NULL,
    is_main INTEGER NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES notebook_folders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notebook_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notebook_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    page_number INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    due_date DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT, -- short-term, long-term, identity, skill
    notes TEXT,
    target_date DATETIME,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS goal_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goal_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    due_date DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT DEFAULT '',
    content TEXT NOT NULL,
    tags TEXT DEFAULT '',
    mood_score INTEGER, -- 1 to 10
    ai_feedback TEXT DEFAULT '',
    ai_feedback_generated_at DATETIME,
    ai_feedback_model TEXT DEFAULT '',
    entry_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    location TEXT,
    project_id INTEGER,
    goal_id INTEGER,
    start_at DATETIME NOT NULL,
    end_at DATETIME NOT NULL,
    recurrence TEXT DEFAULT 'none',
    recurrence_until DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    tags TEXT DEFAULT '',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analytics_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_key TEXT UNIQUE NOT NULL,
    metric_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS finance_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date DATE NOT NULL,
    type TEXT NOT NULL,
    category TEXT,
    amount REAL NOT NULL,
    description TEXT,
    statement_type TEXT DEFAULT '',
    is_recurring INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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
);

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
);

CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    notes TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS food_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Uncategorized',
    serving_label TEXT NOT NULL,
    calories REAL NOT NULL DEFAULT 0,
    protein_g REAL NOT NULL DEFAULT 0,
    carbs_g REAL NOT NULL DEFAULT 0,
    fat_g REAL NOT NULL DEFAULT 0,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS diet_targets (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    calories REAL NOT NULL DEFAULT 0,
    protein_g REAL NOT NULL DEFAULT 0,
    carbs_g REAL NOT NULL DEFAULT 0,
    fat_g REAL NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS gym_routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    goal TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gym_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    day_of_week INTEGER,
    machine TEXT DEFAULT '',
    muscle_group TEXT DEFAULT '',
    sets INTEGER,
    reps TEXT DEFAULT '',
    target_weight REAL,
    notes TEXT DEFAULT '',
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (routine_id) REFERENCES gym_routines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gym_workout_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id INTEGER NOT NULL,
    log_date DATE NOT NULL,
    sets_completed INTEGER,
    reps_completed TEXT DEFAULT '',
    weight_used REAL,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exercise_id) REFERENCES gym_exercises(id) ON DELETE CASCADE
);

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
);

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
);

CREATE TABLE IF NOT EXISTS cv_profiles (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT DEFAULT '',
    headline TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    location TEXT DEFAULT '',
    links TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cv_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_type TEXT NOT NULL,
    title TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cv_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    organization TEXT DEFAULT '',
    location TEXT DEFAULT '',
    start_date DATE,
    end_date DATE,
    description TEXT DEFAULT '',
    bullets TEXT DEFAULT '',
    skills TEXT DEFAULT '',
    display_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (section_id) REFERENCES cv_sections(id) ON DELETE CASCADE
);

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
);

CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_date ON habit_logs(habit_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_habit_logs_date_status ON habit_logs(log_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due_date ON tasks(status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goal_links_goal_id ON goal_links(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_milestones_goal_id ON goal_milestones(goal_id);
CREATE INDEX IF NOT EXISTS idx_beliefs_display_order ON beliefs(display_order, id);
CREATE INDEX IF NOT EXISTS idx_skills_category_order ON skills(category, display_order, id);
CREATE INDEX IF NOT EXISTS idx_admired_people_order ON admired_people(display_order, id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start_at ON calendar_events(start_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_end_at ON calendar_events(end_at);
CREATE INDEX IF NOT EXISTS idx_project_milestones_project_id ON project_milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_notebook_folders_type ON notebook_folders(folder_type, name);
CREATE INDEX IF NOT EXISTS idx_folder_notes_folder_id ON folder_notes(folder_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notebooks_folder_id ON notebooks(folder_id, display_order, id);
CREATE INDEX IF NOT EXISTS idx_notebooks_root ON notebooks(display_order, id) WHERE folder_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_notebook_pages_notebook_id ON notebook_pages(notebook_id, page_number, id);
CREATE INDEX IF NOT EXISTS idx_health_logs_date ON health_logs(log_date DESC);
CREATE INDEX IF NOT EXISTS idx_finance_entries_date ON finance_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_follow_up ON contacts(next_follow_up);
CREATE INDEX IF NOT EXISTS idx_life_reviews_period ON life_reviews(period_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_food_presets_order ON food_presets(display_order, name);
CREATE INDEX IF NOT EXISTS idx_diet_entries_date ON diet_entries(entry_date DESC, meal_type, id DESC);
CREATE INDEX IF NOT EXISTS idx_gym_exercises_routine ON gym_exercises(routine_id, display_order, id);
CREATE INDEX IF NOT EXISTS idx_gym_workout_logs_date ON gym_workout_logs(log_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_media_items_type_status ON media_items(media_type, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_experiences_status ON work_experiences(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_experiences_dates ON work_experiences(start_date DESC, end_date DESC);
CREATE INDEX IF NOT EXISTS idx_cv_sections_order ON cv_sections(display_order, id);
CREATE INDEX IF NOT EXISTS idx_cv_items_section_order ON cv_items(section_id, display_order, id);
CREATE INDEX IF NOT EXISTS idx_linkedin_drafts_status ON linkedin_drafts(email_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkedin_drafts_source ON linkedin_drafts(source_type, source_id);
