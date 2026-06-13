from __future__ import annotations

import logging
import os
from datetime import timedelta
from pathlib import Path
from functools import lru_cache

from flask import Flask, jsonify, render_template, request, session, redirect, url_for

from database import init_app
from utils import ValidationError

import blueprints.analytics_api as analytics_api
import blueprints.calendar_api as calendar_api
import blueprints.goals_api as goals_api
import blueprints.habits_api as habits_api
import blueprints.journal_api as journal_api
import blueprints.library_api as library_api
import blueprints.life_api as life_api
import blueprints.linkedin_api as linkedin_api
import blueprints.notes_api as notes_api
import blueprints.notebooks_api as notebooks_api
import blueprints.notifications_api as notifications_api
import blueprints.os_api as os_api
import blueprints.project_notes_api as project_notes_api
import blueprints.profile_api as profile_api
import blueprints.projects_api as projects_api
import blueprints.settings_api as settings_api
import blueprints.tasks_api as tasks_api
import blueprints.work_api as work_api

BASE_DIR = Path(__file__).resolve().parent
GUEST_ROLE = "guest"
ADMIN_ROLE = "admin"
GUEST_HOME_ENDPOINT = "guest_overview"
GUEST_ALLOWED_PAGE_ENDPOINTS = {"guest_overview", "library", "projects", "work", "profile", "logout", "system_status"}
GUEST_ALLOWED_API_ENDPOINTS = {
    "system_status",
    "library_api.get_summary",
    "library_api.get_items",
    "profile_api.get_profile",
    "profile_api.get_traits",
    "profile_api.get_beliefs",
    "profile_api.get_skills",
    "projects_api.get_projects",
    "projects_api.get_project",
    "work_api.get_work_summary",
    "work_api.get_work_experiences",
}


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue

        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ[key] = value


def _get_env_secret(*names: str) -> str:
    placeholders = {"", "replace-this", "your-google-api-key", "your-api-key"}
    for name in names:
        value = os.environ.get(name, "").strip()
        if value.lower() not in placeholders:
            return value
    return ""


_load_env_file(BASE_DIR / ".env")


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("SECRET_KEY", "lifeweb-secure-session-key-998811"),
        DATABASE=str(BASE_DIR / os.environ.get("LIFEUP_DATABASE", "lifeup.db")),
        MAX_CONTENT_LENGTH=1024 * 1024,
        JSON_SORT_KEYS=False,
        APP_VERSION=os.environ.get("APP_VERSION", "1.0.0"),
        # Security Credentials
        AUTH_USERNAME=os.environ.get("AUTH_USERNAME", "admin"),
        AUTH_PASSWORD=os.environ.get("AUTH_PASSWORD", "2008Ali2008uk##"),
        GUEST_AUTH_USERNAME=os.environ.get("GUEST_AUTH_USERNAME", "guest"),
        GUEST_AUTH_PASSWORD=os.environ.get("GUEST_AUTH_PASSWORD", "lifeOSDemoAcc123#"),
        LINKEDIN_EMAIL_TO=os.environ.get("LINKEDIN_EMAIL_TO", "khadamalihussain@gmail.com"),
        SMTP_HOST=os.environ.get("SMTP_HOST", ""),
        SMTP_PORT=int(os.environ.get("SMTP_PORT", "587")),
        SMTP_USERNAME=os.environ.get("SMTP_USERNAME", ""),
        SMTP_PASSWORD=os.environ.get("SMTP_PASSWORD", ""),
        SMTP_FROM=os.environ.get("SMTP_FROM", os.environ.get("SMTP_USERNAME", "")),
        SMTP_USE_TLS=os.environ.get("SMTP_USE_TLS", "1") != "0",
        LINKEDIN_GENERATION_MODE=os.environ.get("LINKEDIN_GENERATION_MODE", "server"),
        GEMINI_ENABLED=os.environ.get("GEMINI_ENABLED", "1") != "0",
        GEMINI_API_KEY=_get_env_secret("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY", "API_KEY"),
        GEMINI_MODEL=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite"),
        JOURNAL_FEEDBACK_MODEL=os.environ.get(
            "JOURNAL_FEEDBACK_MODEL",
            os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite"),
        ),
        GEMINI_TIMEOUT_SECONDS=float(os.environ.get("GEMINI_TIMEOUT_SECONDS", "45")),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE=os.environ.get("SESSION_COOKIE_SAMESITE", "Lax"),
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "1") != "0",
        SESSION_REFRESH_EACH_REQUEST=False,
        PERMANENT_SESSION_LIFETIME=timedelta(days=int(os.environ.get("SESSION_LIFETIME_DAYS", "14"))),
    )

    if test_config:
        app.config.update(test_config)

    app.json.compact = True
    app.json.sort_keys = False
    logging.basicConfig(level=logging.INFO)

    init_app(app)
    _register_blueprints(app)
    _register_routes(app)
    _register_template_helpers(app)
    _register_error_handlers(app)
    _register_response_hooks(app)
    _register_auth_hooks(app)

    return app


def _register_blueprints(app: Flask) -> None:
    app.register_blueprint(tasks_api.bp)
    app.register_blueprint(habits_api.bp)
    app.register_blueprint(projects_api.bp)
    app.register_blueprint(goals_api.bp)
    app.register_blueprint(analytics_api.bp)
    app.register_blueprint(calendar_api.bp)
    app.register_blueprint(profile_api.bp)
    app.register_blueprint(journal_api.bp)
    app.register_blueprint(library_api.bp)
    app.register_blueprint(life_api.bp)
    app.register_blueprint(linkedin_api.bp)
    app.register_blueprint(notes_api.bp)
    app.register_blueprint(notebooks_api.bp)
    app.register_blueprint(notifications_api.bp)
    app.register_blueprint(os_api.bp)
    app.register_blueprint(project_notes_api.bp)
    app.register_blueprint(settings_api.bp)
    app.register_blueprint(work_api.bp)


def _register_routes(app: Flask) -> None:
    @app.route("/login", methods=["GET", "POST"])
    def login():
        if session.get("logged_in"):
            return redirect(url_for(_home_endpoint_for_role(session.get("user_role"))))
            
        error = None
        if request.method == "POST":
            username = request.form.get("username")
            password = request.form.get("password")
            
            if username == app.config["AUTH_USERNAME"] and password == app.config["AUTH_PASSWORD"]:
                session["logged_in"] = True
                session["user_role"] = ADMIN_ROLE
                session.permanent = True
                return redirect(url_for("dashboard"))
            if username == app.config["GUEST_AUTH_USERNAME"] and password == app.config["GUEST_AUTH_PASSWORD"]:
                session["logged_in"] = True
                session["user_role"] = GUEST_ROLE
                session.permanent = True
                return redirect(url_for(GUEST_HOME_ENDPOINT))
            else:
                error = "Invalid credentials. Access denied."
                
        return render_template("login.html", error=error)

    @app.route("/logout")
    def logout():
        session.pop("logged_in", None)
        session.pop("user_role", None)
        return redirect(url_for("login"))

    @app.route("/")
    def dashboard():
        return render_template("dashboard.html")

    @app.route("/tasks")
    def tasks():
        return render_template("tasks.html")

    @app.route("/habits")
    def habits():
        return render_template("habits.html")

    @app.route("/projects")
    def projects():
        return render_template("projects.html")

    @app.route("/projects/<int:project_id>/notebook")
    def project_notebook(project_id):
        return redirect(url_for("notebooks", project_id=project_id))

    @app.route("/goals")
    def goals():
        return render_template("goals.html")

    @app.route("/analytics")
    def analytics():
        return render_template("analytics.html")

    @app.route("/notes")
    def notes():
        return render_template("notes.html")

    @app.route("/notebooks")
    def notebooks():
        return render_template("notebooks.html")

    @app.route("/journal")
    def journal():
        return render_template("journal.html")

    @app.route("/life")
    def life():
        return render_template("life.html")

    @app.route("/library")
    def library():
        return render_template("library.html")

    @app.route("/guest")
    def guest_overview():
        return render_template("guest_overview.html")

    @app.route("/work")
    def work():
        return render_template("work.html")

    @app.route("/calendar")
    def calendar():
        return render_template("calendar.html")

    @app.route("/mindset")
    def mindset():
        return render_template("mindset.html")

    @app.route("/profile")
    def profile():
        return render_template("profile.html")

    @app.route("/settings")
    def settings():
        return render_template("settings.html")

    @app.route("/api/system_status")
    def system_status():
        return jsonify(
            {
                "status": "online",
                "version": app.config["APP_VERSION"],
                "database": Path(app.config["DATABASE"]).name,
            }
        )


def _register_template_helpers(app: Flask) -> None:
    @lru_cache(maxsize=128)
    def cached_asset_version(relative_path: str) -> int:
        asset_path = BASE_DIR / "static" / relative_path
        try:
            return int(asset_path.stat().st_mtime)
        except FileNotFoundError:
            return 0

    @app.context_processor
    def inject_asset_version():
        def asset_version(relative_path: str) -> int:
            if app.debug:
                cached_asset_version.cache_clear()
            return cached_asset_version(relative_path)

        user_role = session.get("user_role", ADMIN_ROLE if session.get("logged_in") else None)
        return {
            "asset_version": asset_version,
            "is_guest_user": user_role == GUEST_ROLE,
            "current_user_role": user_role,
            "guest_home_endpoint": GUEST_HOME_ENDPOINT,
        }


def _register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ValidationError)
    def handle_validation_error(error: ValidationError):
        return jsonify({"error": error.message, "field": error.field}), error.status_code

    @app.errorhandler(404)
    def handle_not_found(error):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Resource not found."}), 404
        return "Page not found.", 404

    @app.errorhandler(413)
    def handle_too_large(_error):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Request payload is too large."}), 413
        return "Request payload is too large.", 413

    @app.errorhandler(Exception)
    def handle_unexpected_error(error: Exception):
        app.logger.exception("Unhandled application error", exc_info=error)
        if request.path.startswith("/api/"):
            return jsonify({"error": "Internal server error."}), 500
        return "Internal server error.", 500


def _register_response_hooks(app: Flask) -> None:
    @app.after_request
    def apply_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if request.endpoint == "static":
            response.headers["Cache-Control"] = "public, max-age=604800"
        else:
            response.headers["Cache-Control"] = "no-store"
        return response


def _register_auth_hooks(app: Flask) -> None:
    @app.before_request
    def require_login():
        # Exempt routes from login
        exempt_routes = ["login", "static"]
        if request.endpoint not in exempt_routes and not session.get("logged_in"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized access. Authentication required."}), 401
            return redirect(url_for("login"))

        if not session.get("logged_in"):
            return None

        user_role = session.get("user_role", ADMIN_ROLE)
        if user_role != GUEST_ROLE:
            return None

        if request.path.startswith("/api/"):
            if request.endpoint not in GUEST_ALLOWED_API_ENDPOINTS or request.method != "GET":
                return jsonify({"error": "Guest access is read-only and limited to public demo data."}), 403
            return None

        if request.endpoint not in GUEST_ALLOWED_PAGE_ENDPOINTS:
            return redirect(url_for(GUEST_HOME_ENDPOINT))


def _home_endpoint_for_role(user_role: str | None) -> str:
    return GUEST_HOME_ENDPOINT if user_role == GUEST_ROLE else "dashboard"


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")))
