from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AppModule:
    title: str
    endpoint: str
    url: str
    icon: str
    group: str
    subtitle: str
    guest_visible: bool = False
    spacer_before: bool = False
    sidebar_visible: bool = True


MODULE_GROUPS = (
    "Core",
    "Direction",
    "Life",
    "Career",
    "Knowledge",
    "System",
)

APP_MODULES = (
    AppModule("Dashboard", "dashboard", "/", "ph ph-squares-four", "Core", "Your daily operating view."),
    AppModule("Day2Day", "day2day", "/day2day", "ph ph-sun-horizon", "Core", "Habits, tasks, and calendar in one daily workspace."),
    AppModule("Habits", "habits", "/habits", "ph ph-calendar-check", "Core", "Track repeated daily and weekly behavior.", sidebar_visible=False),
    AppModule("Tasks", "tasks", "/tasks", "ph ph-list-checks", "Core", "Manage active work and deadlines.", sidebar_visible=False),
    AppModule("Calendar", "calendar", "/calendar", "ph ph-calendar-blank", "Core", "See schedule blocks and commitments.", sidebar_visible=False),
    AppModule("Build", "build", "/build", "ph ph-stack", "Direction", "Projects, goals, work, and CV in one execution hub.", True),
    AppModule("Projects", "projects", "/projects", "ph ph-kanban", "Direction", "Track project health, milestones, and resources.", True, sidebar_visible=False),
    AppModule("Goals", "goals", "/goals", "ph ph-target", "Direction", "Review long-range targets and milestones.", sidebar_visible=False),
    AppModule("Analytics", "analytics", "/analytics", "ph ph-chart-bar", "Direction", "Performance trends and execution breakdowns."),
    AppModule("Life", "life", "/life", "ph ph-heartbeat", "Life", "Health, diet, finance, contacts, reviews, and resources."),
    AppModule("Mindset", "mindset", "/mindset", "ph ph-brain", "Life", "Beliefs, reflection, and personal operating notes."),
    AppModule("Profile", "profile", "/profile", "ph ph-fingerprint", "Life", "Traits, beliefs, skills, and admired people.", True),
    AppModule("Work", "work", "/work", "ph ph-briefcase", "Career", "Track work experience and career pipeline.", True, sidebar_visible=False),
    AppModule("CV", "cv", "/cv", "ph ph-file-text", "Career", "Maintain a structured master CV.", sidebar_visible=False),
    AppModule("Library", "library", "/library", "ph ph-books", "Knowledge", "Books, media, and learning backlog.", True),
    AppModule("Journal", "journal", "/journal", "ph ph-book-open", "Knowledge", "Journal entries and reflection history."),
    AppModule("Notes", "notes", "/notes", "ph ph-notepad", "Knowledge", "Searchable notes and references."),
    AppModule("Notebooks", "notebooks", "/notebooks", "ph ph-notebook", "Knowledge", "Structured notebooks and project notes."),
    AppModule("Settings", "settings", "/settings", "ph ph-gear", "System", "Export, import, backups, and maintenance.", spacer_before=True),
)


def modules_for_sidebar(*, is_guest: bool) -> list[dict]:
    groups: list[dict] = []
    for group_name in MODULE_GROUPS:
        items = [
            module
            for module in APP_MODULES
            if module.group == group_name and module.sidebar_visible and (not is_guest or module.guest_visible)
        ]
        if items:
            groups.append({"name": group_name, "items": items})
    return groups


def modules_for_commands() -> tuple[AppModule, ...]:
    return APP_MODULES
