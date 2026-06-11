# LifeOS Tracker

This file is a working inventory of the site: pages, core functionality, feature areas, and the main APIs behind them.

## App Shell

### Shared layout

- `templates/base.html`
  - Global sidebar navigation.
  - Top bar with clock.
  - Command palette trigger.
  - Notifications panel.
  - Global alert region.
  - Shared confirm modal.
  - Guest-mode restrictions in the shell.

### Shared frontend systems

- `static/js/core.js`
  - Sidebar toggle.
  - Command palette.
  - Notifications loading.
  - Shared alerts/errors.
  - Shared confirm dialog.
  - Common UI helpers.
- `static/js/api.js`
  - Standardized API requests from the frontend.

## Authentication And Session

### Pages

- `/login`
  - Username/password login.
- `/logout`
  - Session logout.

### Related backend

- `app.py`
  - Session handling.
  - Role-aware page access.
  - Guest account handling.
- `/api/system_status`
  - System status endpoint.

## Main Pages

| Route | Template | Purpose | Main features |
| --- | --- | --- | --- |
| `/` | `dashboard.html` | Overview hub | Summary cards, today/activity metrics, high-level productivity snapshot |
| `/tasks` | `tasks.html` | Task management | Task CRUD, status changes, priorities, due dates, project/goal links, LinkedIn flagging |
| `/habits` | `habits.html` | Habit tracking | Habit CRUD, streak/calendar-style logging, habit history |
| `/projects` | `projects.html` | Project management | Project CRUD, statuses, notes, milestones, linked habits, filtering |
| `/projects/<id>/notebook` | `project_notebook.html` | Project-specific notes | Project note list, editor, note CRUD |
| `/goals` | `goals.html` | Goal tracking | Goal CRUD, milestones, links to related work |
| `/analytics` | `analytics.html` | Data dashboards | Charts, trends, activity analysis, velocity, productivity views |
| `/notes` | `notes.html` | General notes | Note CRUD, pinned notes, editor/detail workflow |
| `/journal` | `journal.html` | Journal entries | Entry CRUD and time-based reflection logging |
| `/life` | `life.html` | Personal life management | Health, diet, finance, contacts, reviews, attachments |
| `/library` | `library.html` | Media/content library | Library item CRUD, status/progress tracking, summary stats |
| `/work` | `work.html` | Work and career tracking | Experience records, summary metrics, LinkedIn draft outbox |
| `/calendar` | `calendar.html` | Calendar planning | Week/month views, event CRUD |
| `/mindset` | `mindset.html` | Mindset presentation page | Structured self-analysis / narrative page |
| `/profile` | `profile.html` | Personal profile data | Traits, beliefs, skills, profile overview |
| `/settings` | `settings.html` | Admin/system tools | Export/import, maintenance tools, system info |
| `/guest` | `guest_overview.html` | Read-only public/demo view | Safe overview for guest access |

## Page Details

### Dashboard

- Template: `templates/dashboard.html`
- Script: `static/js/dashboard.js`
- APIs:
  - `/api/analytics/dashboard`
  - `/api/analytics/today`
  - `/api/analytics/activity`
- Features:
  - Overall productivity snapshot.
  - Quick visibility into active work.
  - Top-level dashboard metrics.

### Tasks

- Template: `templates/tasks.html`
- Script: `static/js/tasks.js`
- APIs:
  - `GET /api/tasks/`
  - `POST /api/tasks/`
  - `PUT /api/tasks/<task_id>`
  - `DELETE /api/tasks/<task_id>`
- Features:
  - Create, update, delete tasks.
  - Task filtering/sorting.
  - Status workflows.
  - Links to projects and goals.
  - Optional LinkedIn-post generation flag when tasks are completed.

### Habits

- Template: `templates/habits.html`
- Script: `static/js/habits.js`
- APIs:
  - `GET /api/habits/`
  - `GET /api/habits/calendar`
  - `POST /api/habits/`
  - `PUT /api/habits/<habit_id>`
  - `POST /api/habits/<habit_id>/log`
  - `GET /api/habits/<habit_id>/logs`
  - `DELETE /api/habits/<habit_id>`
- Features:
  - Habit CRUD.
  - Daily log toggling.
  - Calendar/history views.

### Projects

- Template: `templates/projects.html`
- Script: `static/js/projects.js`
- APIs:
  - `GET /api/projects/`
  - `GET /api/projects/<project_id>`
  - `POST /api/projects/`
  - `PUT /api/projects/<project_id>`
  - `DELETE /api/projects/<project_id>`
  - `POST /api/projects/<project_id>/habits`
  - `DELETE /api/projects/<project_id>/habits/<habit_id>`
  - `POST /api/projects/<project_id>/milestones`
  - `PUT /api/projects/<project_id>/milestones/<milestone_id>`
  - `DELETE /api/projects/<project_id>/milestones/<milestone_id>`
- Features:
  - Project CRUD.
  - Milestone management.
  - Project-linked habits.
  - Completion tracking.
  - Source for project-based LinkedIn drafts.

### Project Notebook

- Template: `templates/project_notebook.html`
- Script: `static/js/project_notebook.js`
- APIs:
  - `GET /api/projects/<project_id>/notes/`
  - `POST /api/projects/<project_id>/notes/`
  - `GET /api/projects/<project_id>/notes/<note_id>`
  - `PUT /api/projects/<project_id>/notes/<note_id>`
  - `DELETE /api/projects/<project_id>/notes/<note_id>`
- Features:
  - Per-project notes.
  - Dedicated project writing workspace.

### Goals

- Template: `templates/goals.html`
- Script: `static/js/goals.js`
- APIs:
  - `GET /api/goals/`
  - `POST /api/goals/`
  - `PUT /api/goals/<goal_id>`
  - `DELETE /api/goals/<goal_id>`
  - `GET /api/goals/<goal_id>/links`
  - `POST /api/goals/<goal_id>/links`
  - `DELETE /api/goals/<goal_id>/links/<link_id>`
  - `POST /api/goals/<goal_id>/milestones`
  - `PUT /api/goals/<goal_id>/milestones/<milestone_id>`
  - `DELETE /api/goals/<goal_id>/milestones/<milestone_id>`
- Features:
  - Goal CRUD.
  - Milestones.
  - Linking goals to other work items.

### Analytics

- Template: `templates/analytics.html`
- Script: `static/js/analytics.js`
- APIs:
  - `/api/analytics/overview`
  - `/api/analytics/habits_monthly`
  - `/api/analytics/dashboard`
  - `/api/analytics/page`
  - `/api/analytics/habit_calendar`
  - `/api/analytics/activity`
  - `/api/analytics/velocity`
  - `/api/analytics/today`
  - `/api/analytics/mood_productivity`
- Features:
  - Charts and summaries.
  - Habit analytics.
  - Activity and velocity tracking.
  - Daily productivity views.

### Notes

- Template: `templates/notes.html`
- Script: `static/js/notes.js`
- APIs:
  - `GET /api/notes/`
  - `GET /api/notes/<note_id>`
  - `POST /api/notes/`
  - `PUT /api/notes/<note_id>`
  - `DELETE /api/notes/<note_id>`
- Features:
  - General note CRUD.
  - Editor/detail flow.
  - Pinned and organized note handling.

### Journal

- Template: `templates/journal.html`
- Script: `static/js/journal.js`
- APIs:
  - `GET /api/journal/`
  - `POST /api/journal/`
  - `PUT /api/journal/<entry_id>`
  - `POST /api/journal/<entry_id>/feedback`
  - `DELETE /api/journal/<entry_id>`
- Features:
  - Journal entry CRUD.
  - Reflective logging over time.
  - Objective AI feedback per entry, generated server-side with Gemini.

### Life

- Template: `templates/life.html`
- Script: `static/js/life.js`
- APIs:
  - `/api/life/summary`
  - `GET/POST/DELETE /api/life/health`
  - `GET/POST/reorder/PUT/DELETE /api/life/diet/presets`
  - `GET/POST/DELETE /api/life/diet`
  - `GET/POST/DELETE /api/life/finance`
  - `GET/POST/PUT/DELETE /api/life/contacts`
  - `GET/POST/DELETE /api/life/reviews`
  - `GET/POST/PUT/DELETE /api/life/attachments`
- Features:
  - Health logging.
  - Diet entry tracking and reusable presets.
  - Finance logging.
  - Contact management.
  - Reviews/reflection records.
  - Attachment storage/metadata.

### Library

- Template: `templates/library.html`
- Script: `static/js/library.js`
- APIs:
  - `/api/library/summary`
  - `GET /api/library/items`
  - `POST /api/library/items`
  - `PUT /api/library/items/<item_id>`
  - `DELETE /api/library/items/<item_id>`
- Features:
  - Media/library item CRUD.
  - Progress/status tracking.
  - Library summary metrics.

### Work

- Template: `templates/work.html`
- Script: `static/js/work.js`
- APIs:
  - `/api/work/summary`
  - `GET /api/work/experiences`
  - `POST /api/work/experiences`
  - `PUT /api/work/experiences/<experience_id>`
  - `DELETE /api/work/experiences/<experience_id>`
  - `GET /api/linkedin/config`
  - `GET /api/linkedin/drafts`
  - `GET /api/linkedin/drafts/<draft_id>`
  - `POST /api/linkedin/drafts/<draft_id>/generate`
  - `POST /api/linkedin/drafts/<draft_id>/send`
- Features:
  - Work experience CRUD.
  - Work summary area.
  - LinkedIn draft outbox.
  - Server-side Gemini draft generation.
  - Email delivery flow for generated drafts when SMTP is configured.

### Calendar

- Template: `templates/calendar.html`
- Script: `static/js/calendar.js`
- APIs:
  - `GET /api/calendar/week`
  - `GET /api/calendar/month`
  - `POST /api/calendar/events`
  - `PUT /api/calendar/events/<event_id>`
  - `DELETE /api/calendar/events/<event_id>`
- Features:
  - Week and month calendar views.
  - Event CRUD.
  - Planning/scheduling interface.

### Mindset

- Template: `templates/mindset.html`
- Script: `static/js/mindset.js`
- Features:
  - Visual/self-analysis page.
  - Strong custom styling and narrative presentation.
- Notes:
  - Snapshot history exists in `snapshots/`.

### Profile

- Template: `templates/profile.html`
- Script: `static/js/profile.js`
- APIs:
  - `GET /api/profile/all`
  - `GET/POST/reorder/PUT/DELETE /api/profile/traits`
  - `GET/POST/reorder/PUT/DELETE /api/profile/beliefs`
  - `GET/POST/reorder/PUT/DELETE /api/profile/skills`
- Features:
  - Profile overview.
  - Traits management.
  - Beliefs management.
  - Skills management.
  - Reordering within sections.

### Settings

- Template: `templates/settings.html`
- Script: `static/js/settings.js`
- APIs:
  - `GET /api/settings/system`
  - `GET /api/settings/export/json`
  - `GET /api/settings/export/db`
  - `POST /api/settings/import/json`
  - `POST /api/settings/maintenance/profile/reset`
  - `POST /api/settings/maintenance/attachments/prune`
  - `POST /api/settings/maintenance/database/vacuum`
- Features:
  - System information.
  - JSON/database export.
  - JSON import.
  - Maintenance actions.

### Guest Overview

- Template: `templates/guest_overview.html`
- Script: `static/js/guest.js`
- Features:
  - Read-only overview.
  - Restricted guest-safe visibility.

## Cross-Cutting Features

### Notifications

- API: `GET /api/notifications/`
- Used by:
  - Global shell notification panel.

### Command Palette / OS Helpers

- APIs:
  - `GET /api/os/command`
  - `GET /api/os/daily-plan`
  - `GET /api/os/weekly-review`
- Used by:
  - Global command/search workflow.
  - Daily planning and weekly review support.

### LinkedIn Draft Automation

- Trigger points:
  - Completed tasks with `linkedin_post_enabled`.
  - Completed projects with `linkedin_post_enabled`.
- Related backend:
  - `services.py`
  - `blueprints/linkedin_api.py`
- Current provider:
  - Google Gemini via server-side API call.
- Output workflow:
  - Draft record created.
  - Post body generated.
  - Email attempted if SMTP is configured.

### Journal AI Feedback

- Trigger point:
  - Manual feedback generation from each journal entry card.
- Related backend:
  - `blueprints/journal_api.py`
  - `services.py`
- Current provider:
  - Google Gemini via server-side API call.
- Default model:
  - `gemini-2.5-flash-lite` through `JOURNAL_FEEDBACK_MODEL`.
- Feedback style:
  - Objective pattern and blind-spot analysis.
  - Avoids praise, reassurance, diagnosis, or feel-good summaries.

## Data/Storage Areas

- SQLite database: `lifeup.db`
- Schema source: `schema.sql`
- Shared business logic: `services.py`
- Shared validation/parsing utilities: `utils.py`

## Styling Map

- `static/css/base.css`
  - App shell, sidebar, top bar, layout.
- `static/css/components.css`
  - Shared cards, forms, buttons, modals, list items, utility components.
- `static/css/life.css`
  - Life page layout and some shared side-panel styling.
- `static/css/library.css`
  - Library-specific presentation.
- `static/css/calendar.css`
  - Calendar layouts and controls.
- `static/css/mindset.css`
  - Mindset page visual identity.
- `static/css/profile.css`
  - Profile-specific layouts/charts.
- `static/css/settings.css`
  - Settings page layout/tools.
- `static/css/dashboard.css`
  - Legacy dashboard styles; verify before relying on it.

## Maintenance Notes

- If a new page is added:
  - Add route, template, script, API ownership, and feature summary here.
- If a feature is removed:
  - Remove or mark the page/API in this file to keep the tracker accurate.
- If navigation changes:
  - Update the App Shell and Main Pages sections.
