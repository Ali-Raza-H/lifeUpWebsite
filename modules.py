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
    "Growth",
    "Knowledge",
    "System",
)

APP_MODULES = (
    AppModule("Dashboard", "dashboard", "/", "ph ph-squares-four", "Core", "Your daily operating view."),
    AppModule("Day2Day", "day2day", "/day2day", "ph ph-sun-horizon", "Core", "Habits, tasks, and calendar in one daily workspace."),
    AppModule("Habits", "habits", "/habits", "ph ph-calendar-check", "Core", "Track repeated daily and weekly behavior.", sidebar_visible=False),
    AppModule("Tasks", "tasks", "/tasks", "ph ph-list-checks", "Core", "Manage active work and deadlines.", sidebar_visible=False),
    AppModule("Calendar", "calendar", "/calendar", "ph ph-calendar-blank", "Core", "See schedule blocks and commitments.", sidebar_visible=False),
    AppModule("Journal", "journal", "/journal", "ph ph-book-open", "Core", "Journal entries and reflection history."),
    AppModule("Life", "life", "/life", "ph ph-heartbeat", "Core", "Health, diet, finance, contacts, reviews, and resources."),
    AppModule("Build", "build", "/build", "ph ph-stack", "Core", "Projects, goals, work, and CV in one execution hub.", True),
    AppModule("Projects", "projects", "/projects", "ph ph-kanban", "Core", "Track project health, milestones, and resources.", True, sidebar_visible=False),
    AppModule("Goals", "goals", "/goals", "ph ph-target", "Core", "Review long-range targets and milestones.", sidebar_visible=False),
    AppModule("Work", "work", "/work", "ph ph-briefcase", "Core", "Track work experience and career pipeline.", True, sidebar_visible=False),
    AppModule("CV", "cv", "/cv", "ph ph-file-text", "Core", "Maintain a structured master CV.", sidebar_visible=False),
    AppModule("Analytics", "analytics", "/analytics", "ph ph-chart-bar", "Growth", "Performance trends and execution breakdowns."),
    AppModule("Mindset", "mindset", "/mindset", "ph ph-brain", "Growth", "Beliefs, reflection, and personal operating notes."),
    AppModule("Profile", "profile", "/profile", "ph ph-fingerprint", "Growth", "Traits, beliefs, skills, and admired people.", True),
    AppModule("Library", "library", "/library", "ph ph-books", "Knowledge", "Books, media, and learning backlog.", True),
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
