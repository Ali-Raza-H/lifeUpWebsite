# LifeWeb Technical Reference Documentation

This document provides an exhaustive, granular reference for the `lifeWeb` codebase. It details the architecture, component roles, data flow, and specific functionality of every part of the system.

---

## 1. High-Level Architecture
`lifeWeb` follows a classic Flask application pattern:
- **`app.py`**: The central brain. Configures the Flask application, defines core routes, registers blueprints (the modular API controllers), and manages security/auth middleware.
- **`blueprints/`**: The controller layer. Each file acts as an API controller for a specific domain entity (e.g., `tasks_api.py` manages task-related API requests).
- **`database.py` & `schema.sql`**: The data layer. `schema.sql` defines the SQLite table structure, while `database.py` handles connection management, helper queries, migrations, and database initialization.
- **`services.py`**: The logic layer. Contains higher-order business logic that may span across different API domains (e.g., metric calculations).
- **`templates/` & `static/`**: The presentation layer. HTML templates (`templates/`) render views, and JavaScript (`static/js/`) handles client-side interaction and API communication.

---

## 2. API Reference (`blueprints/`)

Each blueprint is mounted under `/api/<name>`.

### 2.1. Tasks API (`blueprints/tasks_api.py`)
- **Prefix:** `/api/tasks`
- **Purpose:** Manages the task CRUD lifecycle, including status updates, project/goal association, and synchronization with the calendar.
- **Key Functions:**
  - `get_tasks`: Supports filtering by status, project, goal, due window, and search queries.
  - `create_task`/`update_task`: Handles creation/updates, automatically triggers calendar synchronization (`sync_calendar_event_for_task`) and optional LinkedIn drafting.

### 2.2. Goals API (`blueprints/goals_api.py`)
- **Prefix:** `/api/goals`
- **Purpose:** Manages goal lifecycle (long-term/short-term/identity/skill), goal-linked resources (links), and progress tracking (milestones).
- **Key Functions:**
  - CRUD for goals.
  - CRUD for goal links (`/api/goals/<id>/links`).
  - CRUD for goal milestones (`/api/goals/<id>/milestones`).

### 2.3. Projects API (`blueprints/projects_api.py`)
- **Prefix:** `/api/projects`
- **Purpose:** Manages project lifecycles, project milestones, and habits linked to projects.
- **Key Functions:**
  - Comprehensive `get_project` endpoint returns a project with its milestones, habits, and attachments in one payload.
  - Handles project completion logic (including optional LinkedIn drafting).

### 2.4. Library API (`blueprints/library_api.py`)
- **Prefix:** `/api/library`
- **Purpose:** Tracks media consumption (books, anime, etc.).
- **Key Functions:**
  - `get_summary`: Aggregates media consumption metrics.
  - `get_items`: Fetches media, supporting filtering by type and sophisticated sorting.

### 2.5. Life API (`blueprints/life_api.py`)
- **Prefix:** `/api/life`
- **Purpose:** A catch-all API for personal metrics: health logs, diet entries, finances, contacts, reviews, and attachments.
- **Key Functions:**
  - `get_summary`: Provides a consolidated view of today's health, diet, and finance metrics.
  - Handles various sub-entities (health, diet, finance, contacts, reviews, attachments).

### 2.6. OS API (`blueprints/os_api.py`)
- **Prefix:** `/api/os`
- **Purpose:** Powers the "Operating System" features, like the Command Palette, Daily Plan, and Weekly Review.
- **Key Functions:**
  - `command_palette`: A robust search engine across tasks, projects, goals, events, notes, journal entries, and contacts.
  - `daily_plan`: Aggregates the day's focus (primary task, schedule blocks) and risk assessments.
  - `weekly_review`: Aggregates performance metrics over the last week.

### 2.7. Journal API (`blueprints/journal_api.py`)
- **Prefix:** `/api/journal`
- **Purpose:** Manages journal entries, including AI-driven feedback integration.
- **Key Functions:**
  - CRUD for entries with search, mood, and tag filtering.
  - `generate_feedback`: Triggers the AI service to provide entry feedback.

### 2.8. LinkedIn API (`blueprints/linkedin_api.py`)
- **Prefix:** `/api/linkedin`
- **Purpose:** Manages the generation and sending of LinkedIn content drafts via email.

### 2.9. Work API (`blueprints/work_api.py`)
- **Prefix:** `/api/work`
- **Purpose:** Tracks work experience, job applications, and career pipeline.

### 2.10. Settings API (`blueprints/settings_api.py`)
- **Prefix:** `/api/settings`
- **Purpose:** System maintenance, data export/import, and profile reset functionality.

*(Note: Other APIs like `habits_api`, `calendar_api`, `notes_api`, etc., follow this same pattern of mapping routes to CRUD operations on database tables via `database.py`.)*

---

## 3. Data Layer (`database.py` & `schema.sql`)

### 3.1. `schema.sql`
Defines the relational model. Key relationships:
- `tasks` link to `projects`, `goals`, and `calendar_events`.
- `project_habits` (many-to-many link between projects and habits).
- `project_milestones` (linked to `projects`).
- `goal_milestones`/`goal_links` (linked to `goals`).

### 3.2. `database.py`
Provides the critical infrastructure for the data layer:
- `get_db()`: Manages the `sqlite3` connection within the Flask context.
- `execute_db()`: Helper for `INSERT`, `UPDATE`, `DELETE`.
- `query_db()`: Helper for `SELECT` queries.
- `init_db()`: Handles schema application, migrations, and seeding data.

---

## 4. UI Layer Interaction

The UI consists of:
1.  **Templates (`templates/`)**: Jinja2 files that provide the structure for each page.
2.  **Scripts (`static/js/`)**: Vanilla JavaScript files for each page.

**General UI Interaction Pattern:**
When a page loads (e.g., `/tasks`), the corresponding `tasks.js` script makes one or more `fetch()` calls to the API (e.g., `/api/tasks`). The API returns JSON data, which the JavaScript then renders into the DOM using simple template literals or DOM manipulation, keeping the UI reactive without heavy frameworks.

---

## 5. Summary of Operations
- **System Startup:** `app.py` -> `create_app` -> `init_app` -> `init_db` (sets up schema and applies migrations).
- **Request Flow:** `Blueprint Route` -> `Database Helper` (or `Service Helper`) -> `JSON Response`.
- **Business Logic:** Encapsulated primarily in `services.py`, with API blueprints acting as lightweight controllers.
- **Client Interaction:** `HTML Page` -> `JS Controller` (using `fetch`) -> `API Endpoint`.
