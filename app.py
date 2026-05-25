from __future__ import annotations

import logging
import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request, session, redirect, url_for

from database import init_app
from utils import ValidationError

import blueprints.analytics_api as analytics_api
import blueprints.calendar_api as calendar_api
import blueprints.goals_api as goals_api
import blueprints.habits_api as habits_api
import blueprints.journal_api as journal_api
import blueprints.notes_api as notes_api
import blueprints.project_notes_api as project_notes_api
import blueprints.profile_api as profile_api
import blueprints.projects_api as projects_api
import blueprints.settings_api as settings_api
import blueprints.tasks_api as tasks_api

BASE_DIR = Path(__file__).resolve().parent


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
    )

    if test_config:
        app.config.update(test_config)

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
    app.register_blueprint(project_notes_api.bp)
    app.register_blueprint(settings_api.bp)


def _register_routes(app: Flask) -> None:
    @app.route("/login", methods=["GET", "POST"])
    def login():
        if session.get("logged_in"):
            return redirect(url_for("dashboard"))
            
        error = None
        if request.method == "POST":
            username = request.form.get("username")
            password = request.form.get("password")
            
            if username == app.config["AUTH_USERNAME"] and password == app.config["AUTH_PASSWORD"]:
                session["logged_in"] = True
                session.permanent = True
                return redirect(url_for("dashboard"))
            else:
                error = "Invalid credentials. Access denied."
                
        return render_template("login.html", error=error)

    @app.route("/logout")
    def logout():
        session.pop("logged_in", None)
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
        return render_template("project_notebook.html", project_id=project_id)

    @app.route("/goals")
    def goals():
        return render_template("goals.html")

    @app.route("/analytics")
    def analytics():
        return render_template("analytics.html")

    @app.route("/notes")
    def notes():
        return render_template("notes.html")

    @app.route("/journal")
    def journal():
        return render_template("journal.html")

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
    @app.context_processor
    def inject_asset_version():
        def asset_version(relative_path: str) -> int:
            asset_path = BASE_DIR / "static" / relative_path
            try:
                return int(asset_path.stat().st_mtime)
            except FileNotFoundError:
                return 0

        return {"asset_version": asset_version}


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


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")))
