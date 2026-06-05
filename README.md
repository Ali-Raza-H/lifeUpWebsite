# LifeOS

Personal productivity dashboard built with Flask, SQLite, vanilla JavaScript, and CSS.

## Run

```powershell
python -m pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000`.

## Test

```powershell
python -m pytest
```

## Project Map

### App Core

| File | Purpose |
| --- | --- |
| `app.py` | Creates the Flask app, registers routes, auth, API blueprints, template helpers, and security headers. Page routes return templates. |
| `database.py` | SQLite connection helpers, app initialization, schema migration, and database access utilities. |
| `schema.sql` | Source schema for the SQLite database. |
| `services.py` | Shared business logic for tasks, habits, projects, goals, analytics, profile, notes, life, and library data. |
| `utils.py` | Validation, parsing, date, and response helper functions used across blueprints/services. |
| `lifeup.db` | Local SQLite database. Treat as user/runtime data unless you intentionally want to reset data. |
| `seed.py` | Seeds demo/default data into the database. |
| `migrate_notes.py` | Legacy notes migration helper. |
| `run.bat` | Windows launcher/menu for backend and browser process management. |
| `requirements.txt` | Python dependencies. |
| `tests/` | API and app behavior tests. |

### API Blueprints

Every file in `blueprints/` exposes JSON endpoints for one feature area.

| File | Owns |
| --- | --- |
| `blueprints/tasks_api.py` | Task CRUD, filtering, status updates. |
| `blueprints/habits_api.py` | Habit CRUD and habit log toggles. |
| `blueprints/projects_api.py` | Project CRUD, project links, milestones, timeline data. |
| `blueprints/project_notes_api.py` | Project notebook notes. |
| `blueprints/goals_api.py` | Goals, milestones, goal links. |
| `blueprints/analytics_api.py` | Dashboard/analytics summary data. |
| `blueprints/calendar_api.py` | Calendar events and calendar views. |
| `blueprints/profile_api.py` | Profile/mindset data reads. |
| `blueprints/settings_api.py` | Settings CRUD for traits, beliefs, skills, exports/imports. |
| `blueprints/notes_api.py` | General notes CRUD. |
| `blueprints/journal_api.py` | Journal entries. |
| `blueprints/life_api.py` | Health, diet, finance, contacts, reviews, attachments. |
| `blueprints/library_api.py` | Media library entries. |

## Frontend Map

Each feature normally has three pieces:

| Feature | Template | JavaScript | API | Main CSS |
| --- | --- | --- | --- | --- |
| App shell/nav | `templates/base.html` | `static/js/core.js` | `app.py` | `static/css/base.css`, `static/css/components.css` |
| Login | `templates/login.html` | none | `app.py` auth hooks | Inline style in `templates/login.html` |
| Dashboard | `templates/dashboard.html` | `static/js/dashboard.js` | `analytics_api.py`, `tasks_api.py` | Shared CSS, old `static/css/dashboard.css` if imported later |
| Tasks | `templates/tasks.html` | `static/js/tasks.js` | `tasks_api.py` | Shared CSS |
| Habits | `templates/habits.html` | `static/js/habits.js` | `habits_api.py` | Shared CSS |
| Projects | `templates/projects.html` | `static/js/projects.js` | `projects_api.py` | Shared CSS |
| Project notebook | `templates/project_notebook.html` | `static/js/project_notebook.js` | `project_notes_api.py` | Shared CSS |
| Goals | `templates/goals.html` | `static/js/goals.js` | `goals_api.py` | Shared CSS plus inline goal modal styles |
| Analytics | `templates/analytics.html` | `static/js/analytics.js` | `analytics_api.py` | Shared CSS |
| Notes | `templates/notes.html` | `static/js/notes.js` | `notes_api.py` | Shared CSS |
| Journal | `templates/journal.html` | `static/js/journal.js` | `journal_api.py` | Shared CSS |
| Life | `templates/life.html` | `static/js/life.js` | `life_api.py` | `static/css/life.css`, shared CSS |
| Library | `templates/library.html` | `static/js/library.js` | `library_api.py` | `static/css/life.css`, `static/css/library.css`, shared CSS |
| Calendar | `templates/calendar.html` | `static/js/calendar.js` | `calendar_api.py` | `static/css/calendar.css`, shared CSS |
| Mindset | `templates/mindset.html` | `static/js/mindset.js` | `profile_api.py` | `static/css/mindset.css` |
| Profile | `templates/profile.html` | `static/js/profile.js` | `profile_api.py` | `static/css/profile.css`, shared CSS |
| Settings | `templates/settings.html` | `static/js/settings.js` | `settings_api.py` | `static/css/settings.css`, shared CSS |

## Style Ownership

### Global Theme

| Style file | What belongs here |
| --- | --- |
| `static/css/variables.css` | Design tokens: colors, typography variables, spacing, radius, glow shadows, legacy aliases. Change app-wide colors here first. |
| `static/css/base.css` | App shell: body, sidebar, top bar, content scroll area, page header/title, scrollbar, mobile shell layout. |
| `static/css/components.css` | Shared UI system: cards, lists, buttons, badges, form controls, filters, modals, boards, metrics, notes editor, project notebook, trackers, habit/calendar cells, EasyMDE overrides. |

### Page-Specific Styles

| Style file | What belongs here |
| --- | --- |
| `static/css/mindset.css` | Mindset page's strongest visual style: big typography, arrow list treatment, metric layout, panel layout. |
| `static/css/life.css` | Life page side panel navigation, life list containers, diet previews, finance colors, responsive life layout. Also affects Library because `library.html` imports it. |
| `static/css/library.css` | Library shelves, media entry cards, progress pills, library-specific grid and modal width. |
| `static/css/calendar.css` | Calendar toolbar, view toggle, week/month layouts, event pills, agenda list, calendar modal width. |
| `static/css/profile.css` | Profile charts, trait rows, skill tiles, profile skill modal width. |
| `static/css/settings.css` | Settings grids, toolbars, record lists, import preview, settings modal layout. |
| `static/css/dashboard.css` | Older dashboard-only styles. It is not currently imported by `dashboard.html`; keep or remove intentionally. |

## Menu And Navigation Notes

- Main left sidebar menu lives in `templates/base.html`.
- Sidebar width, collapse behavior, active/hover states, mobile nav layout, and top bar styling live in `static/css/base.css`.
- Sidebar clock, collapse toggle, app alerts, confirmations, and shared utility behavior live in `static/js/core.js`.
- Per-page header buttons live in each template's `{% block header_actions %}`.
- Per-page secondary menus/panels:
  - Life and Library left panel items: templates `life.html` / `library.html`, styles in `life.css`, behavior in `life.js` / `library.js`.
  - Calendar view toggle and filters: `calendar.html`, `calendar.css`, `calendar.js`.
  - Tasks/Projects board columns and filters: `tasks.html` / `projects.html`, shared CSS, `tasks.js` / `projects.js`.
  - Notes sidebar list/filter: `notes.html`, shared CSS, `notes.js`.

## Safe Editing Rules

- Do not remove IDs that JavaScript queries. Examples: `task-sort`, `task-due-filter`, `project-goal-filter`, `current-note-id`, `notes-pinned-only`, `goals-results-count`, `projects-results-count`, `library-stats-*`, `library-count-*`.
- Do not rename CSS classes used by JavaScript for panel switching, especially `life-nav-item`, `life-content-panel`, `active`, `compact-item`, and board/list container IDs.
- Prefer visual changes in CSS first. Only edit templates when adding/removing real controls or changing structure.
- Shared styling should go in `components.css`; shell/sidebar styling should go in `base.css`; page-specific exceptions should go in that page's CSS file.
- After menu/template changes, run `python -m pytest -q` and check the affected route in the browser.

## Runtime And Generated Files

| Path | Notes |
| --- | --- |
| `.run-state/` | Runtime PID/browser profile state from `run.bat`. Not source code. |
| `__pycache__/`, `tests/__pycache__/`, `blueprints/__pycache__/` | Python bytecode caches. Not source code. |
| `snapshots/` | Mindset design/version reference snapshots. Useful for visual history, not loaded by the app. |
| `.pytest_cache/` | Pytest cache. Not source code. |

## Optional Environment Variables

```powershell
$env:SECRET_KEY = "replace-this"
$env:LIFEUP_DATABASE = "lifeup.db"
$env:APP_VERSION = "1.0.0"
$env:PORT = "5000"
```
