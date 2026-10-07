from __future__ import annotations

from functools import wraps
import json
import time
import uuid

from flask import Blueprint, Response, current_app, g, jsonify, make_response, request, stream_with_context

from assistant_auth import KNOWN_ASSISTANT_SCOPES
from assistant_events import acknowledge_assistant_event, list_assistant_events, materialize_current_notifications, publish_assistant_event
from database import execute_db, query_db
from services import dashboard_today_payload
from utils import row_to_dict

import blueprints.calendar_api as calendar_api
import blueprints.goals_api as goals_api
import blueprints.habits_api as habits_api
import blueprints.journal_api as journal_api
import blueprints.library_api as library_api
import blueprints.life_api as life_api
import blueprints.notes_api as notes_api
import blueprints.notebooks_api as notebooks_api
import blueprints.work_api as work_api
import blueprints.cv_api as cv_api
import blueprints.linkedin_api as linkedin_api
import blueprints.analytics_api as analytics_api
import blueprints.os_api as os_api
import blueprints.settings_api as settings_api
import blueprints.projects_api as projects_api
import blueprints.tasks_api as tasks_api


bp = Blueprint("assistant_api", __name__, url_prefix="/api/v1/assistant")


def _json_response_body(response: Response) -> object:
    payload = response.get_json(silent=True)
    return payload if payload is not None else {"message": response.get_data(as_text=True)}


def _extract_entity_id(payload: object) -> int | None:
    if isinstance(payload, dict):
        if isinstance(payload.get("id"), int):
            return payload["id"]
        for value in payload.values():
            entity_id = _extract_entity_id(value)
            if entity_id is not None:
                return entity_id
    return None


def _audit(operation: str, response: Response, *, entity_type: str | None = None) -> None:
    api_key = getattr(g, "assistant_api_key", None)
    if not api_key:
        return
    payload = _json_response_body(response) if response.is_json else None
    execute_db(
        """
        INSERT INTO assistant_audit_log (
            api_key_id, operation, method, path, entity_type, entity_id,
            idempotency_key, status_code
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            api_key["id"],
            operation,
            request.method,
            request.path,
            entity_type,
            _extract_entity_id(payload),
            request.headers.get("Idempotency-Key"),
            response.status_code,
        ),
    )


def _idempotent_replay() -> Response | None:
    key = request.headers.get("Idempotency-Key", "").strip()
    if not key:
        return None
    if len(key) > 200:
        return make_response(
            jsonify({"error": "invalid_idempotency_key", "message": "Idempotency-Key must be at most 200 characters."}),
            400,
        )
    row = query_db(
        """
        SELECT method, path, status_code, response_json
        FROM assistant_idempotency
        WHERE api_key_id = ? AND idempotency_key = ?
        """,
        [g.assistant_api_key["id"], key],
        one=True,
    )
    if not row:
        return None
    if row["method"] != request.method or row["path"] != request.path:
        return make_response(
            jsonify(
                {
                    "error": "idempotency_conflict",
                    "message": "This Idempotency-Key was already used for a different operation.",
                }
            ),
            409,
        )
    response = make_response(jsonify(json.loads(row["response_json"])), int(row["status_code"]))
    response.headers["X-Idempotent-Replay"] = "true"
    return response


def _store_idempotent_response(response: Response) -> None:
    key = request.headers.get("Idempotency-Key", "").strip()
    if not key or not response.is_json or response.status_code >= 500:
        return
    execute_db(
        """
        INSERT OR IGNORE INTO assistant_idempotency (
            api_key_id, idempotency_key, method, path, status_code, response_json
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            g.assistant_api_key["id"],
            key,
            request.method,
            request.path,
            response.status_code,
            json.dumps(_json_response_body(response), separators=(",", ":")),
        ),
    )


def assistant_endpoint(
    operation: str,
    *required_scopes: str,
    write: bool = False,
    entity_type: str | None = None,
):
    def decorator(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            granted = getattr(g, "assistant_scopes", set())
            missing = [
                scope for scope in required_scopes
                if "*" not in granted
                and not any(candidate in granted for candidate in scope.split("|"))
            ]
            if missing:
                response = make_response(
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
                _audit(operation, response, entity_type=entity_type)
                return response

            if write:
                replay = _idempotent_replay()
                if replay is not None:
                    _audit(operation, replay, entity_type=entity_type)
                    return replay

            response = make_response(function(*args, **kwargs))
            response.headers["X-Request-ID"] = request.headers.get("X-Request-ID") or uuid.uuid4().hex
            if write:
                _store_idempotent_response(response)
            _audit(operation, response, entity_type=entity_type)
            if write and response.status_code < 300 and entity_type in {"task", "project", "project_milestone"}:
                payload = _json_response_body(response)
                entity_id = _extract_entity_id(payload)
                if entity_id is not None:
                    entity = payload
                    if isinstance(payload, dict):
                        for value in payload.values():
                            if isinstance(value, dict) and value.get("id") == entity_id:
                                entity = value
                                break
                    event_type = {
                        "task": "task.changed",
                        "project": "project.changed",
                        "project_milestone": "project.milestone_changed",
                    }[entity_type]
                    event_key = (
                        f"{operation}:{entity_type}:{entity_id}:"
                        f"{request.headers.get('Idempotency-Key') or request.headers.get('X-Request-ID') or uuid.uuid4().hex}"
                    )
                    action = operation.rsplit(".", 1)[-1]
                    verb = "created" if action == "create" else "updated"
                    publish_assistant_event(
                        event_type,
                        str(entity.get("title") or entity.get("name") or f"{entity_type} {entity_id}"),
                        message=f"{entity_type.replace('_', ' ').title()} was {verb}.",
                        severity="low",
                        source_type=f"{entity_type}_lifecycle",
                        source_id=entity_id,
                        payload={"operation": operation, "entity_type": entity_type, "entity": entity},
                        event_key=event_key,
                    )
            return response

        return wrapped

    return decorator


@bp.get("/capabilities")
@assistant_endpoint("capabilities.read", "lifeos:read")
def capabilities():
    transports = ["rest", "polling"]
    if current_app.config.get("ASSISTANT_SSE_ENABLED", False):
        transports.append("sse")
    return jsonify(
        {
            "api_version": "v1",
            "authenticated_key": {
                "name": g.assistant_api_key["name"],
                "key_prefix": g.assistant_api_key["key_prefix"],
                "scopes": sorted(g.assistant_scopes),
            },
            "known_scopes": KNOWN_ASSISTANT_SCOPES,
            "deletions_available": False,
            "transports": transports,
            "recommended_notification_transport": "polling",
        }
    )


@bp.get("/context/today")
@assistant_endpoint("context.today", "lifeos:read")
def context_today():
    today = dashboard_today_payload()
    daily_plan = os_api.daily_plan().get_json()
    granted = getattr(g, "assistant_scopes", set())
    if "*" not in granted and "sensitive:contacts" not in granted:
        today.pop("follow_ups_due", None)
        daily_plan.get("metrics", {}).pop("follow_ups_due", None)
        daily_plan["blocks"] = [item for item in daily_plan.get("blocks", []) if item.get("action_url") != "/life"]
        daily_plan["actions"] = [
            item
            for item in daily_plan.get("actions", [])
            if item.get("title") != "Clear relationship follow-ups"
        ]
    return jsonify({"today": today, "daily_plan": daily_plan})


@bp.get("/context/weekly-review")
@assistant_endpoint("context.weekly_review", "lifeos:read")
def context_weekly_review():
    response = os_api.weekly_review()
    payload = response.get_json()
    granted = getattr(g, "assistant_scopes", set())
    has_all = "*" in granted

    hidden_scorecard_labels = set()
    if not has_all and "sensitive:journal" not in granted:
        hidden_scorecard_labels.add("Journal entries")
    if not has_all and "sensitive:finance" not in granted:
        hidden_scorecard_labels.add("Net money")
        payload.get("evidence", {}).pop("finance", None)
    if not has_all and "sensitive:health" not in granted:
        payload.get("evidence", {}).pop("health", None)
        payload.get("evidence", {}).pop("diet", None)
        payload["wins"] = [item for item in payload.get("wins", []) if item.get("title") != "Exercise was logged"]
        payload["risks"] = [item for item in payload.get("risks", []) if item.get("title") != "Sleep average is low"]
    if not has_all and "sensitive:contacts" not in granted:
        payload.get("evidence", {}).pop("contacts_touched", None)
        payload["risks"] = [
            item
            for item in payload.get("risks", [])
            if item.get("title") != "Relationship follow-ups are due"
        ]
        payload["next_focus"] = [
            item
            for item in payload.get("next_focus", [])
            if item.get("title") != "Clear due follow-ups"
        ]

    payload["scorecard"] = [
        item for item in payload.get("scorecard", []) if item.get("label") not in hidden_scorecard_labels
    ]
    return jsonify(payload)


@bp.get("/search")
@assistant_endpoint("search", "lifeos:read")
def search():
    response = os_api.command_palette()
    payload = response.get_json()
    granted = getattr(g, "assistant_scopes", set())
    allowed_types = {"task", "project", "goal", "event", "note", "library", "page", "section", "command"}
    if "*" in granted or "sensitive:journal" in granted:
        allowed_types.add("journal")
    if "*" in granted or "sensitive:contacts" in granted:
        allowed_types.add("contact")
    payload["results"] = [item for item in payload.get("results", []) if item.get("type") in allowed_types]
    return jsonify(payload)


@bp.get("/tasks")
@assistant_endpoint("tasks.list", "lifeos:read|tasks:read", entity_type="task")
def list_tasks():
    return tasks_api.get_tasks()


@bp.get("/tasks/<int:task_id>")
@assistant_endpoint("tasks.get", "lifeos:read|tasks:read", entity_type="task")
def get_task(task_id: int):
    row = query_db("SELECT * FROM tasks WHERE id = ?", [task_id], one=True)
    if not row:
        return jsonify({"error": "not_found", "message": "Task not found."}), 404
    return jsonify({"task": row_to_dict(row)})


@bp.post("/tasks")
@assistant_endpoint("tasks.create", "lifeos:write|tasks:write", write=True, entity_type="task")
def create_task():
    return tasks_api.create_task()


@bp.patch("/tasks/<int:task_id>")
@assistant_endpoint("tasks.update", "lifeos:write|tasks:write", write=True, entity_type="task")
def update_task(task_id: int):
    current = query_db("SELECT revision FROM tasks WHERE id = ?", [task_id], one=True)
    if not current:
        return jsonify({"error": "not_found", "message": "Task not found."}), 404
    payload = request.get_json(silent=True) or {}
    expected = request.headers.get("If-Match")
    if expected is None and isinstance(payload, dict):
        expected = payload.pop("expected_revision", None)
    if expected is not None:
        expected = str(expected).strip()
        if expected.startswith("W/"):
            return jsonify({"error": "validation_error", "message": "Weak ETags are not supported for task revisions."}), 400
        try:
            expected_revision = int(expected.strip('"'))
        except (TypeError, ValueError):
            return jsonify({"error": "validation_error", "message": "If-Match must be a task revision."}), 400
        if expected_revision != int(current["revision"] or 1):
            server = query_db("SELECT * FROM tasks WHERE id = ?", [task_id], one=True)
            return jsonify({"error": "conflict", "message": "Task changed on the server.", "server": row_to_dict(server), "expected_revision": expected_revision}), 409
    return tasks_api.update_task(task_id)


@bp.get("/projects")
@assistant_endpoint("projects.list", "lifeos:read", entity_type="project")
def list_projects():
    return projects_api.get_projects()


@bp.get("/projects/<int:project_id>")
@assistant_endpoint("projects.get", "lifeos:read", entity_type="project")
def get_project(project_id: int):
    return projects_api.get_project(project_id)


@bp.post("/projects")
@assistant_endpoint("projects.create", "lifeos:write", write=True, entity_type="project")
def create_project():
    return projects_api.create_project()


@bp.patch("/projects/<int:project_id>")
@assistant_endpoint("projects.update", "lifeos:write", write=True, entity_type="project")
def update_project(project_id: int):
    return projects_api.update_project(project_id)


@bp.post("/projects/<int:project_id>/milestones")
@assistant_endpoint("projects.milestones.create", "lifeos:write", write=True, entity_type="project_milestone")
def create_project_milestone(project_id: int):
    return projects_api.create_milestone(project_id)


@bp.patch("/projects/<int:project_id>/milestones/<int:milestone_id>")
@assistant_endpoint("projects.milestones.update", "lifeos:write", write=True, entity_type="project_milestone")
def update_project_milestone(project_id: int, milestone_id: int):
    return projects_api.update_milestone(project_id, milestone_id)


@bp.get("/goals")
@assistant_endpoint("goals.list", "lifeos:read", entity_type="goal")
def list_goals():
    return goals_api.get_goals()


@bp.post("/goals")
@assistant_endpoint("goals.create", "lifeos:write", write=True, entity_type="goal")
def create_goal():
    return goals_api.create_goal()


@bp.patch("/goals/<int:goal_id>")
@assistant_endpoint("goals.update", "lifeos:write", write=True, entity_type="goal")
def update_goal(goal_id: int):
    return goals_api.update_goal(goal_id)


@bp.post("/goals/<int:goal_id>/milestones")
@assistant_endpoint("goals.milestones.create", "lifeos:write", write=True, entity_type="goal_milestone")
def create_goal_milestone(goal_id: int):
    return goals_api.create_goal_milestone(goal_id)


@bp.patch("/goals/<int:goal_id>/milestones/<int:milestone_id>")
@assistant_endpoint("goals.milestones.update", "lifeos:write", write=True, entity_type="goal_milestone")
def update_goal_milestone(goal_id: int, milestone_id: int):
    return goals_api.update_goal_milestone(goal_id, milestone_id)


@bp.get("/work/experiences")
@assistant_endpoint("work.experiences.list", "lifeos:read")
def list_work_experiences():
    return work_api.get_work_experiences()


@bp.post("/work/experiences")
@assistant_endpoint("work.experiences.create", "lifeos:write", write=True, entity_type="work_experience")
def create_work_experience():
    return work_api.create_work_experience()


@bp.route("/work/experiences/<int:experience_id>", methods=["PUT", "PATCH"])
@assistant_endpoint("work.experiences.update", "lifeos:write", write=True, entity_type="work_experience")
def update_work_experience(experience_id: int):
    return work_api.update_work_experience(experience_id)


@bp.get("/cv/sections")
@assistant_endpoint("cv.sections.list", "lifeos:read")
def list_cv_sections():
    return cv_api.get_cv_sections()


@bp.post("/cv/sections")
@assistant_endpoint("cv.sections.create", "lifeos:write", write=True, entity_type="cv_section")
def create_cv_section():
    return cv_api.create_cv_section()


@bp.post("/cv/items")
@assistant_endpoint("cv.items.create", "lifeos:write", write=True, entity_type="cv_item")
def create_cv_item():
    return cv_api.create_cv_item()


@bp.route("/cv/items/<int:item_id>", methods=["PUT", "PATCH"])
@assistant_endpoint("cv.items.update", "lifeos:write", write=True, entity_type="cv_item")
def update_cv_item(item_id: int):
    return cv_api.update_cv_item(item_id)


@bp.get("/linkedin/drafts")
@assistant_endpoint("linkedin.drafts.list", "lifeos:read")
def list_linkedin_drafts():
    return linkedin_api.get_linkedin_drafts()


@bp.post("/linkedin/drafts/<int:draft_id>/send")
@assistant_endpoint("linkedin.drafts.send", "external:send", write=True, entity_type="linkedin_draft")
def send_linkedin_draft(draft_id: int):
    return linkedin_api.send_linkedin_draft(draft_id)


@bp.post("/linkedin/drafts/<int:draft_id>/generate")
@assistant_endpoint("linkedin.drafts.generate", "external:send", write=True, entity_type="linkedin_draft")
def generate_linkedin_draft(draft_id: int):
    return linkedin_api.generate_linkedin_draft_route(draft_id)


@bp.get("/notebooks/workspace")
@assistant_endpoint("notebooks.workspace", "lifeos:read")
def get_notebook_workspace():
    return notebooks_api.workspace()


@bp.get("/analytics/overview")
@assistant_endpoint("analytics.overview", "lifeos:read")
def get_analytics_overview():
    return analytics_api.get_overview()


@bp.get("/analytics/page")
@assistant_endpoint("analytics.page", "lifeos:read")
def get_analytics_page():
    return analytics_api.get_analytics_page_payload()


@bp.get("/analytics/velocity")
@assistant_endpoint("analytics.velocity", "lifeos:read")
def get_analytics_velocity():
    return analytics_api.get_velocity()


@bp.get("/analytics/habit-calendar")
@assistant_endpoint("analytics.habit_calendar", "lifeos:read")
def get_analytics_habit_calendar():
    return analytics_api.habit_calendar()


@bp.get("/analytics/mood-productivity")
@assistant_endpoint("analytics.mood_productivity", "lifeos:read")
def get_analytics_mood_productivity():
    return analytics_api.get_mood_productivity()


@bp.get("/analytics/today")
@assistant_endpoint("analytics.today", "lifeos:read")
def get_analytics_today():
    return analytics_api.get_today()


@bp.get("/analytics/activity")
@assistant_endpoint("analytics.activity", "lifeos:read")
def get_analytics_activity():
    return analytics_api.get_activity()


@bp.get("/settings/system")
@assistant_endpoint("settings.system", "lifeos:read")
def get_system_summary():
    return settings_api.system_summary()


@bp.get("/cv/profile")
@assistant_endpoint("cv.profile.read", "lifeos:read")
def get_cv_profile():
    return cv_api.get_cv_profile()


@bp.put("/cv/profile")
@assistant_endpoint("cv.profile.update", "lifeos:write", write=True, entity_type="cv_profile")
def update_cv_profile():
    return cv_api.update_cv_profile()


@bp.get("/cv/preview")
@assistant_endpoint("cv.preview", "lifeos:read")
def get_cv_preview():
    return cv_api.get_cv_preview()


@bp.get("/linkedin/config")
@assistant_endpoint("linkedin.config", "lifeos:read")
def get_linkedin_config():
    return linkedin_api.get_linkedin_config()


@bp.get("/linkedin/drafts/<int:draft_id>")
@assistant_endpoint("linkedin.drafts.get", "lifeos:read", entity_type="linkedin_draft")
def get_linkedin_draft(draft_id: int):
    return linkedin_api.get_linkedin_draft(draft_id)


@bp.post("/linkedin/drafts/<int:draft_id>/generation")
@assistant_endpoint("linkedin.drafts.finalize_generation", "external:send", write=True, entity_type="linkedin_draft")
def finalize_linkedin_draft_generation(draft_id: int):
    return linkedin_api.complete_linkedin_draft_generation(draft_id)


@bp.get("/notebooks/folders/<int:folder_id>")
@assistant_endpoint("notebooks.folder", "lifeos:read")
def get_notebook_folder(folder_id: int):
    return notebooks_api.get_folder(folder_id)


@bp.post("/notebooks/folders")
@assistant_endpoint("notebooks.folders.create", "lifeos:write", write=True)
def create_notebook_folder():
    return notebooks_api.create_folder()


@bp.post("/notebooks/folders/<int:folder_id>/notes")
@assistant_endpoint("notebooks.folder_notes.create", "lifeos:write", write=True)
def create_folder_note(folder_id: int):
    return notebooks_api.create_folder_note(folder_id)


@bp.post("/notebooks/notebooks")
@assistant_endpoint("notebooks.create", "lifeos:write", write=True)
def create_notebook():
    return notebooks_api.create_standalone_notebook()


@bp.route("/notebooks/notebooks/<int:notebook_id>", methods=["PUT", "PATCH"])
@assistant_endpoint("notebooks.update", "lifeos:write", write=True)
def update_notebook(notebook_id: int):
    return notebooks_api.update_notebook(notebook_id)


@bp.post("/notebooks/notebooks/<int:notebook_id>/pages")
@assistant_endpoint("notebooks.pages.create", "lifeos:write", write=True)
def create_notebook_page(notebook_id: int):
    return notebooks_api.create_page(notebook_id)


@bp.get("/notebooks/pages/<int:page_id>")
@assistant_endpoint("notebooks.pages.get", "lifeos:read")
def get_notebook_page(page_id: int):
    return notebooks_api.get_page(page_id)


@bp.route("/notebooks/pages/<int:page_id>", methods=["PUT", "PATCH"])
@assistant_endpoint("notebooks.pages.update", "lifeos:write", write=True)
def update_notebook_page(page_id: int):
    return notebooks_api.update_page(page_id)


@bp.get("/habits")
@assistant_endpoint("habits.list", "lifeos:read", entity_type="habit")
def list_habits():
    return habits_api.get_habits()


@bp.post("/habits")
@assistant_endpoint("habits.create", "lifeos:write", write=True, entity_type="habit")
def create_habit():
    return habits_api.create_habit()


@bp.patch("/habits/<int:habit_id>")
@assistant_endpoint("habits.update", "lifeos:write", write=True, entity_type="habit")
def update_habit(habit_id: int):
    return habits_api.update_habit(habit_id)


@bp.post("/habits/<int:habit_id>/logs")
@assistant_endpoint("habits.log", "lifeos:write", write=True, entity_type="habit")
def log_habit(habit_id: int):
    return habits_api.log_habit(habit_id)


@bp.get("/calendar")
@assistant_endpoint("calendar.list", "lifeos:read", entity_type="calendar_event")
def list_calendar():
    return calendar_api.get_month() if request.args.get("month") else calendar_api.get_week()


@bp.post("/calendar/events")
@assistant_endpoint("calendar.create", "lifeos:write", write=True, entity_type="calendar_event")
def create_calendar_event():
    return calendar_api.create_event()


@bp.patch("/calendar/events/<int:event_id>")
@assistant_endpoint("calendar.update", "lifeos:write", write=True, entity_type="calendar_event")
def update_calendar_event(event_id: int):
    return calendar_api.update_event(event_id)


@bp.get("/notes")
@assistant_endpoint("notes.list", "lifeos:read", entity_type="note")
def list_notes():
    return notes_api.get_notes()


@bp.post("/notes")
@assistant_endpoint("notes.create", "lifeos:write", write=True, entity_type="note")
def create_note():
    return notes_api.create_note()


@bp.patch("/notes/<int:note_id>")
@assistant_endpoint("notes.update", "lifeos:write", write=True, entity_type="note")
def update_note(note_id: int):
    return notes_api.update_note(note_id)


@bp.get("/library/items")
@assistant_endpoint("library.list", "lifeos:read", entity_type="library_item")
def list_library_items():
    return library_api.get_items()


@bp.post("/library/items")
@assistant_endpoint("library.create", "lifeos:write", write=True, entity_type="library_item")
def create_library_item():
    return library_api.create_item()


@bp.patch("/library/items/<int:item_id>")
@assistant_endpoint("library.update", "lifeos:write", write=True, entity_type="library_item")
def update_library_item(item_id: int):
    return library_api.update_item(item_id)


@bp.get("/contacts")
@assistant_endpoint("contacts.list", "sensitive:contacts", entity_type="contact")
def list_contacts():
    return life_api.get_contacts()


@bp.post("/contacts")
@assistant_endpoint("contacts.create", "sensitive:contacts", "lifeos:write", write=True, entity_type="contact")
def create_contact():
    return life_api.create_contact()


@bp.patch("/contacts/<int:contact_id>")
@assistant_endpoint("contacts.update", "sensitive:contacts", "lifeos:write", write=True, entity_type="contact")
def update_contact(contact_id: int):
    return life_api.update_contact(contact_id)


@bp.get("/journal")
@assistant_endpoint("journal.list", "sensitive:journal", entity_type="journal_entry")
def list_journal():
    return journal_api.get_entries()


@bp.post("/journal")
@assistant_endpoint("journal.create", "sensitive:journal", "lifeos:write", write=True, entity_type="journal_entry")
def create_journal():
    return journal_api.create_entry()


@bp.patch("/journal/<int:entry_id>")
@assistant_endpoint("journal.update", "sensitive:journal", "lifeos:write", write=True, entity_type="journal_entry")
def update_journal(entry_id: int):
    return journal_api.update_entry(entry_id)


@bp.get("/health")
@assistant_endpoint("health.list", "sensitive:health", entity_type="health_log")
def list_health():
    return life_api.get_health_logs()


@bp.post("/health")
@assistant_endpoint("health.create", "sensitive:health", "lifeos:write", write=True, entity_type="health_log")
def create_health():
    return life_api.create_health_log()


@bp.get("/diet")
@assistant_endpoint("diet.list", "sensitive:health", entity_type="diet_entry")
def list_diet():
    return life_api.get_diet_entries()


@bp.post("/diet")
@assistant_endpoint("diet.create", "sensitive:health", "lifeos:write", write=True, entity_type="diet_entry")
def create_diet():
    return life_api.create_diet_entry()


@bp.get("/gym/routines")
@assistant_endpoint("gym.routines.list", "sensitive:health", entity_type="gym_routine")
def list_gym_routines():
    return life_api.get_gym_routines()


@bp.get("/gym/logs")
@assistant_endpoint("gym.logs.list", "sensitive:health", entity_type="gym_log")
def list_gym_logs():
    return life_api.get_gym_logs()


@bp.post("/gym/logs")
@assistant_endpoint("gym.logs.create", "sensitive:health", "lifeos:write", write=True, entity_type="gym_log")
def create_gym_log():
    return life_api.create_gym_log()


@bp.get("/finance")
@assistant_endpoint("finance.list", "sensitive:finance", entity_type="finance_entry")
def list_finance():
    return life_api.get_finance_entries()


@bp.post("/finance")
@assistant_endpoint("finance.create", "sensitive:finance", "lifeos:write", write=True, entity_type="finance_entry")
def create_finance():
    return life_api.create_finance_entry()


@bp.patch("/finance/<int:entry_id>")
@assistant_endpoint("finance.update", "sensitive:finance", "lifeos:write", write=True, entity_type="finance_entry")
def update_finance(entry_id: int):
    return life_api.update_finance_entry(entry_id)


@bp.get("/tasks/<int:task_id>/focus-sessions")
@assistant_endpoint("focus.sessions.list", "focus:read")
def list_focus_sessions(task_id: int):
    if not query_db("SELECT id FROM tasks WHERE id = ?", [task_id], one=True):
        return jsonify({"error": "not_found", "message": "Task not found."}), 404
    rows = query_db(
        "SELECT * FROM focus_sessions WHERE task_id = ? ORDER BY started_at DESC, id DESC LIMIT 200",
        [task_id],
    )
    return jsonify({"sessions": [dict(row) for row in rows]})


@bp.get("/focus-sessions")
@assistant_endpoint("focus.sessions.all", "focus:read")
def list_all_focus_sessions():
    limit = max(1, min(request.args.get("limit", default=100, type=int), 500))
    rows = query_db(
        "SELECT * FROM focus_sessions ORDER BY started_at DESC, id DESC LIMIT ?",
        [limit],
    )
    return jsonify({"sessions": [dict(row) for row in rows]})


@bp.post("/focus-sessions")
@assistant_endpoint("focus.sessions.create", "focus:write", write=True, entity_type="focus_session")
def create_focus_session():
    from datetime import datetime

    from utils import get_optional_int, get_optional_string, get_required_string, iso_now, require_object

    payload = require_object(request.get_json(silent=True))
    session_key = get_required_string(payload, "session_key", max_length=160)
    timer_id = get_optional_string(payload, "timer_id", max_length=160, default="") or ""
    session_type = get_optional_string(payload, "session_type", max_length=40, default="pomodoro") or "pomodoro"
    if session_type not in {"pomodoro", "timer", "reminder", "break", "stopwatch"}:
        return jsonify({"error": "validation_error", "message": "Invalid session_type."}), 400
    task_id = get_optional_int(payload, "task_id", minimum=1)
    planned_seconds = get_optional_int(payload, "planned_seconds", minimum=0, default=0) or 0
    elapsed_seconds = get_optional_int(payload, "elapsed_seconds", minimum=0, default=0) or 0
    status = get_optional_string(payload, "status", max_length=20, default="running") or "running"
    if status not in {"running", "completed", "cancelled"}:
        return jsonify({"error": "validation_error", "message": "Invalid session status."}), 400
    started_at = get_optional_string(payload, "started_at", max_length=64, default=iso_now()) or iso_now()
    try:
        datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    except ValueError:
        return jsonify({"error": "validation_error", "message": "started_at must be ISO-8601."}), 400
    ended_at = get_optional_string(payload, "ended_at", max_length=64, default="") or None
    notes = get_optional_string(payload, "notes", max_length=1000, default="") or ""
    if task_id is not None and not query_db("SELECT id FROM tasks WHERE id = ?", [task_id], one=True):
        return jsonify({"error": "validation_error", "message": "task_id does not exist."}), 400
    existing = query_db("SELECT * FROM focus_sessions WHERE session_key = ?", [session_key], one=True)
    if existing:
        # Reposting the same stable session key with a terminal state finalizes
        # an offline-queued start without creating duplicate time entries.
        if status in {"completed", "cancelled"} or elapsed_seconds > int(existing["elapsed_seconds"]):
            ended_at = ended_at or (iso_now() if status in {"completed", "cancelled"} else None)
            execute_db(
                "UPDATE focus_sessions SET elapsed_seconds = ?, status = ?, ended_at = COALESCE(?, ended_at), notes = ? WHERE id = ?",
                (elapsed_seconds, status, ended_at, notes, existing["id"]),
            )
            existing = query_db("SELECT * FROM focus_sessions WHERE id = ?", [existing["id"]], one=True)
        return jsonify({"session": dict(existing), "message": "Session already exists."}), 200
    session_id = execute_db(
        """
        INSERT INTO focus_sessions (
            session_key, task_id, timer_id, session_type, planned_seconds, elapsed_seconds,
            started_at, ended_at, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (session_key, task_id, timer_id, session_type, planned_seconds, elapsed_seconds,
         started_at, ended_at, status, notes),
    )
    row = query_db("SELECT * FROM focus_sessions WHERE id = ?", [session_id], one=True)
    return jsonify({"session": dict(row), "message": "Focus session recorded."}), 201


@bp.patch("/focus-sessions/<int:session_id>")
@assistant_endpoint("focus.sessions.update", "focus:write", write=True, entity_type="focus_session")
def update_focus_session(session_id: int):
    from utils import get_optional_int, get_optional_string, require_object

    current = query_db("SELECT * FROM focus_sessions WHERE id = ?", [session_id], one=True)
    if not current:
        return jsonify({"error": "not_found", "message": "Focus session not found."}), 404
    payload = require_object(request.get_json(silent=True))
    from utils import iso_now

    elapsed = get_optional_int(payload, "elapsed_seconds", minimum=0, default=int(current["elapsed_seconds"]))
    status = get_optional_string(payload, "status", max_length=20, default=current["status"]) or current["status"]
    if status in {"completed", "cancelled"} and "ended_at" not in payload:
        ended_at = iso_now()
    else:
        ended_at = get_optional_string(payload, "ended_at", max_length=64, default=current["ended_at"] or "") or None
    if status not in {"running", "completed", "cancelled"}:
        return jsonify({"error": "validation_error", "message": "Invalid session status."}), 400
    notes = get_optional_string(payload, "notes", max_length=1000, default=current["notes"]) or ""
    execute_db(
        "UPDATE focus_sessions SET elapsed_seconds = ?, status = ?, ended_at = ?, notes = ? WHERE id = ?",
        (elapsed, status, ended_at, notes, session_id),
    )
    row = query_db("SELECT * FROM focus_sessions WHERE id = ?", [session_id], one=True)
    return jsonify({"session": dict(row), "message": "Focus session updated."})


@bp.get("/events")
@assistant_endpoint("events.list", "events:read", entity_type="assistant_event")
def list_events():
    materialize_current_notifications()
    after_id = max(0, request.args.get("after", default=0, type=int))
    limit = max(1, min(request.args.get("limit", default=50, type=int), 200))
    include_acknowledged = request.args.get("include_acknowledged") == "1"
    granted = getattr(g, "assistant_scopes", set())
    excluded_source_types = () if "*" in granted or "sensitive:contacts" in granted else ("contact",)
    events = list_assistant_events(
        after_id=after_id,
        limit=limit,
        include_acknowledged=include_acknowledged,
        exclude_source_types=excluded_source_types,
    )
    return jsonify({"events": events, "last_event_id": events[-1]["id"] if events else after_id})


@bp.post("/events/<int:event_id>/acknowledge")
@assistant_endpoint("events.acknowledge", "events:ack", write=True, entity_type="assistant_event")
def acknowledge_event(event_id: int):
    event = acknowledge_assistant_event(event_id)
    if not event:
        return jsonify({"error": "not_found", "message": "Assistant event not found."}), 404
    return jsonify({"event": event, "message": "Event acknowledged."})


@bp.get("/events/stream")
@assistant_endpoint("events.stream", "events:read", entity_type="assistant_event")
def stream_events():
    if not current_app.config.get("ASSISTANT_SSE_ENABLED", False):
        return (
            jsonify(
                {
                    "error": "transport_unavailable",
                    "message": "SSE is disabled for this deployment. Poll GET /events instead.",
                }
            ),
            503,
        )

    header_id = request.headers.get("Last-Event-ID", "").strip()
    after_id = request.args.get("after", default=0, type=int)
    if header_id.isdigit():
        after_id = max(after_id, int(header_id))
    heartbeat_seconds = max(5, min(int(current_app.config.get("ASSISTANT_EVENT_HEARTBEAT_SECONDS", 15)), 60))
    granted = getattr(g, "assistant_scopes", set())
    excluded_source_types = () if "*" in granted or "sensitive:contacts" in granted else ("contact",)

    @stream_with_context
    def generate():
        nonlocal after_id
        while True:
            materialize_current_notifications()
            events = list_assistant_events(
                after_id=after_id,
                limit=100,
                exclude_source_types=excluded_source_types,
            )
            if events:
                for event in events:
                    after_id = int(event["id"])
                    yield f"id: {after_id}\nevent: {event['event_type']}\ndata: {json.dumps(event, separators=(',', ':'))}\n\n"
            else:
                yield f": heartbeat {int(time.time())}\n\n"
            time.sleep(heartbeat_seconds)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
