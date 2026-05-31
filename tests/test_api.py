from datetime import date, timedelta


def test_task_lifecycle_sets_completed_timestamp(client):
    response = client.post(
        "/api/tasks/",
        json={"title": "Ship production app", "description": "Finish the remaining fixes", "priority": 1},
    )
    assert response.status_code == 201
    task = response.get_json()["task"]
    assert task["status"] == "pending"
    assert task["completed_at"] is None

    update_response = client.put(f"/api/tasks/{task['id']}", json={"status": "completed"})
    assert update_response.status_code == 200
    updated_task = update_response.get_json()["task"]
    assert updated_task["status"] == "completed"
    assert updated_task["completed_at"] is not None

    completed_response = client.get("/api/tasks/?status=completed")
    assert completed_response.status_code == 200
    assert len(completed_response.get_json()) == 1


def test_habit_logging_returns_live_metrics(client):
    create_response = client.post("/api/habits/", json={"name": "Read", "frequency": "daily"})
    assert create_response.status_code == 201
    habit = create_response.get_json()["habit"]

    update_response = client.put(
        f"/api/habits/{habit['id']}",
        json={"category": "study", "target_streak": 12, "description": "Reading practice"},
    )
    assert update_response.status_code == 200
    updated_habit = update_response.get_json()["habit"]
    assert updated_habit["category"] == "study"
    assert updated_habit["target_streak"] == 12

    today = date.today().isoformat()
    log_response = client.post(f"/api/habits/{habit['id']}/log", json={"date": today, "status": "completed"})
    assert log_response.status_code == 200
    logged_habit = log_response.get_json()["habit"]
    assert logged_habit["today_status"] == "completed"
    assert logged_habit["current_streak"] >= 1
    assert logged_habit["recent_logs"][today] == "completed"

    calendar_response = client.get(f"/api/habits/calendar?month={today[:7]}")
    assert calendar_response.status_code == 200
    payload = calendar_response.get_json()
    assert payload["month"] == today[:7]
    calendar_habit = next(item for item in payload["habits"] if item["id"] == habit["id"])
    today_cell = next(cell for cell in calendar_habit["calendar_cells"] if cell.get("date") == today)
    assert today_cell["status"] == "completed"


def test_habit_logging_rejects_future_dates(client):
    create_response = client.post("/api/habits/", json={"name": "Workout", "frequency": "daily"})
    assert create_response.status_code == 201
    habit = create_response.get_json()["habit"]

    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    log_response = client.post(f"/api/habits/{habit['id']}/log", json={"date": tomorrow, "status": "completed"})
    assert log_response.status_code == 400
    assert log_response.get_json()["error"] == "Future habit tracking is not allowed."


def test_project_progress_uses_related_tasks(client):
    project_response = client.post("/api/projects/", json={"name": "Website overhaul"})
    assert project_response.status_code == 201
    project_id = project_response.get_json()["project"]["id"]

    task_response = client.post(
        "/api/tasks/",
        json={"title": "Deploy", "project_id": project_id, "status": "in_progress"},
    )
    assert task_response.status_code == 201

    projects_response = client.get("/api/projects/")
    assert projects_response.status_code == 200
    project = projects_response.get_json()[0]
    assert project["task_count"] == 1
    assert project["progress"] == 50

    task_id = task_response.get_json()["task"]["id"]
    complete_response = client.put(f"/api/tasks/{task_id}", json={"status": "completed"})
    assert complete_response.status_code == 200

    refreshed_project = client.get("/api/projects/").get_json()[0]
    assert refreshed_project["progress"] == 100


def test_project_progress_combines_stages_and_tasks(client):
    project_response = client.post("/api/projects/", json={"name": "Stage tracked project"})
    assert project_response.status_code == 201
    project_id = project_response.get_json()["project"]["id"]

    task_response = client.post(
        "/api/tasks/",
        json={"title": "Build component", "project_id": project_id, "status": "completed"},
    )
    assert task_response.status_code == 201

    stage_response = client.post(
        f"/api/projects/{project_id}/milestones",
        json={"title": "Prototype", "status": "in_progress"},
    )
    assert stage_response.status_code == 201

    project = client.get("/api/projects/").get_json()[0]
    assert project["task_count"] == 1
    assert project["milestone_count"] == 1
    assert project["completed_task_count"] == 1
    assert project["in_progress_milestone_count"] == 1
    assert project["progress"] == 75


def test_task_and_project_links_can_be_cleared(client):
    project = client.post("/api/projects/", json={"name": "Linked project"}).get_json()["project"]
    goal = client.post("/api/goals/", json={"title": "Linked goal"}).get_json()["goal"]
    task = client.post(
        "/api/tasks/",
        json={"title": "Linked task", "project_id": project["id"], "goal_id": goal["id"], "estimated_minutes": 25},
    ).get_json()["task"]

    task_update = client.put(
        f"/api/tasks/{task['id']}",
        json={"project_id": None, "goal_id": None, "estimated_minutes": None},
    )
    assert task_update.status_code == 200
    updated_task = task_update.get_json()["task"]
    assert updated_task["project_id"] is None
    assert updated_task["goal_id"] is None
    assert updated_task["estimated_minutes"] is None

    project_update = client.put(f"/api/projects/{project['id']}", json={"goal_id": None})
    assert project_update.status_code == 200
    assert project_update.get_json()["project"]["goal_id"] is None


def test_goal_notes_and_completion_metadata(client):
    create_response = client.post(
        "/api/goals/",
        json={
            "title": "Reach C2 writing level",
            "type": "skill",
            "notes": "Focus on weekly essays and direct feedback loops.",
            "status": "completed",
        },
    )
    assert create_response.status_code == 201
    goal = create_response.get_json()["goal"]
    assert goal["notes"] == "Focus on weekly essays and direct feedback loops."
    assert goal["completed_at"] is not None

    update_response = client.put(
        f"/api/goals/{goal['id']}",
        json={"status": "active", "notes": "Reopened for further practice."},
    )
    assert update_response.status_code == 200
    updated_goal = update_response.get_json()["goal"]
    assert updated_goal["notes"] == "Reopened for further practice."
    assert updated_goal["completed_at"] is None


def test_goal_links_can_be_created_listed_and_deleted(client):
    goal = client.post("/api/goals/", json={"title": "Build revision system"}).get_json()["goal"]

    create_response = client.post(
        f"/api/goals/{goal['id']}/links",
        json={"title": "Revision site", "url": "revision.example.com"},
    )
    assert create_response.status_code == 201
    link = create_response.get_json()["link"]
    assert link["title"] == "Revision site"
    assert link["url"] == "https://revision.example.com"

    goals_payload = client.get("/api/goals/").get_json()
    refreshed_goal = next(item for item in goals_payload if item["id"] == goal["id"])
    assert refreshed_goal["link_count"] == 1
    assert refreshed_goal["links"][0]["id"] == link["id"]

    listed = client.get(f"/api/goals/{goal['id']}/links")
    assert listed.status_code == 200
    assert listed.get_json()[0]["url"] == "https://revision.example.com"

    delete_response = client.delete(f"/api/goals/{goal['id']}/links/{link['id']}")
    assert delete_response.status_code == 200
    assert client.get(f"/api/goals/{goal['id']}/links").get_json() == []


def test_goal_milestones_count_toward_progress(client):
    goal = client.post("/api/goals/", json={"title": "Build full life tracker"}).get_json()["goal"]

    task_response = client.post(
        "/api/tasks/",
        json={"title": "Plan views", "goal_id": goal["id"], "status": "completed"},
    )
    assert task_response.status_code == 201

    milestone_response = client.post(
        f"/api/goals/{goal['id']}/milestones",
        json={"title": "Health module", "status": "in_progress", "due_date": "2026-06-03"},
    )
    assert milestone_response.status_code == 201
    milestone = milestone_response.get_json()["milestone"]

    goals_payload = client.get("/api/goals/").get_json()
    refreshed_goal = next(item for item in goals_payload if item["id"] == goal["id"])
    assert refreshed_goal["milestone_count"] == 1
    assert refreshed_goal["completed_task_count"] == 1
    assert refreshed_goal["in_progress_milestone_count"] == 1
    assert refreshed_goal["progress"] == 75

    update_response = client.put(
        f"/api/goals/{goal['id']}/milestones/{milestone['id']}",
        json={"status": "completed"},
    )
    assert update_response.status_code == 200
    assert update_response.get_json()["milestone"]["completed_at"] is not None

    delete_response = client.delete(f"/api/goals/{goal['id']}/milestones/{milestone['id']}")
    assert delete_response.status_code == 200


def test_life_tracker_core_modules(client):
    health = client.post(
        "/api/life/health",
        json={
            "log_date": "2026-05-29",
            "sleep_hours": 7.5,
            "weight_kg": 70.2,
            "exercise_minutes": 45,
            "energy_score": 8,
            "symptoms": "None",
        },
    )
    assert health.status_code == 201

    finance = client.post(
        "/api/life/finance",
        json={
            "entry_date": "2026-05-29",
            "type": "subscription",
            "category": "Hosting",
            "amount": 12.5,
            "is_recurring": True,
        },
    )
    assert finance.status_code == 201

    contact = client.post(
        "/api/life/contacts",
        json={"name": "Alex", "relation": "Mentor", "priority": "high", "next_follow_up": "2026-05-29"},
    )
    assert contact.status_code == 201
    contact_id = contact.get_json()["contact"]["id"]

    review = client.post(
        "/api/life/reviews",
        json={
            "period_type": "weekly",
            "period_start": "2026-05-25",
            "score": 8,
            "wins": "Shipped tracker",
            "next_focus": "Polish",
        },
    )
    assert review.status_code == 201

    attachment = client.post(
        "/api/life/attachments",
        json={"entity_type": "goal", "entity_id": 1, "title": "Planning board", "url": "board.example.com"},
    )
    assert attachment.status_code == 201
    assert attachment.get_json()["attachment"]["url"] == "https://board.example.com"

    summary = client.get("/api/life/summary").get_json()
    assert summary["latest_health"]["sleep_hours"] == 7.5
    assert summary["contacts_due"] == 1
    assert client.get("/api/life/finance").get_json()[0]["is_recurring"] == 1

    update_contact = client.put(f"/api/life/contacts/{contact_id}", json={"priority": "normal"})
    assert update_contact.status_code == 200
    assert update_contact.get_json()["contact"]["priority"] == "normal"


def test_life_diet_tracker_uses_presets_and_calculates_macros(client):
    presets_response = client.get("/api/life/diet/presets")
    assert presets_response.status_code == 200
    presets = presets_response.get_json()
    assert len(presets) >= 1

    chicken = next(item for item in presets if item["name"] == "Chicken Breast")
    roti = next(item for item in presets if item["name"] == "Roti")
    monster = next(item for item in presets if item["name"] == "Monster Energy Original")
    assert roti["category"] == "Pakistani Staples"
    assert monster["category"] == "Drinks"
    today = date.today().isoformat()

    create_response = client.post(
        "/api/life/diet",
        json={
            "entry_date": today,
            "preset_id": chicken["id"],
            "meal_type": "lunch",
            "servings": 2,
            "notes": "Post workout meal",
        },
    )
    assert create_response.status_code == 201
    entry = create_response.get_json()["entry"]
    assert entry["food_name"] == "Chicken Breast"
    assert entry["category"] == "Protein & Basics"
    assert entry["meal_type"] == "lunch"
    assert entry["calories"] == 330
    assert entry["protein_g"] == 62

    entries_response = client.get("/api/life/diet")
    assert entries_response.status_code == 200
    entries = entries_response.get_json()
    assert entries[0]["id"] == entry["id"]

    summary = client.get("/api/life/summary")
    assert summary.status_code == 200
    today_diet = summary.get_json()["today_diet"]
    assert today_diet["entry_count"] == 1
    assert today_diet["calories"] == 330
    assert today_diet["protein_g"] == 62


def test_life_diet_tracker_validates_preset_presence(client):
    response = client.post(
        "/api/life/diet",
        json={
            "entry_date": date.today().isoformat(),
            "meal_type": "dinner",
            "servings": 1,
        },
    )
    assert response.status_code == 400
    assert response.get_json()["error"] == "Preset food is required."


def test_library_tracker_supports_crud_summary_and_filters(client):
    book_response = client.post(
        "/api/library/items",
        json={
            "title": "Omniscient Reader's Viewpoint",
            "media_type": "manhwa",
            "status": "in_progress",
            "platform": "Webtoon",
            "current_unit": 48,
            "total_units": 200,
            "notes": "Main weekly read.",
        },
    )
    assert book_response.status_code == 201
    first_item = book_response.get_json()["item"]
    assert first_item["media_type"] == "manhwa"
    assert first_item["current_unit"] == 48

    film_response = client.post(
        "/api/library/items",
        json={
            "title": "Spirited Away",
            "media_type": "movie",
            "status": "completed",
            "score": 10,
            "creator": "Studio Ghibli",
        },
    )
    assert film_response.status_code == 201
    second_item = film_response.get_json()["item"]
    assert second_item["completed_on"] is not None

    filtered_items = client.get("/api/library/items?type=manhwa")
    assert filtered_items.status_code == 200
    filtered_payload = filtered_items.get_json()
    assert len(filtered_payload) == 1
    assert filtered_payload[0]["id"] == first_item["id"]

    summary = client.get("/api/library/summary")
    assert summary.status_code == 200
    summary_payload = summary.get_json()
    assert summary_payload["total_items"] == 2
    assert summary_payload["in_progress_count"] == 1
    assert summary_payload["completed_count"] == 1
    assert summary_payload["type_breakdown"]["manhwa"] == 1
    assert summary_payload["average_score"] == 10.0

    update_response = client.put(
        f"/api/library/items/{first_item['id']}",
        json={"status": "completed", "current_unit": 200, "total_units": 200, "score": 9},
    )
    assert update_response.status_code == 200
    updated_item = update_response.get_json()["item"]
    assert updated_item["status"] == "completed"
    assert updated_item["completed_on"] is not None
    assert updated_item["score"] == 9

    delete_response = client.delete(f"/api/library/items/{second_item['id']}")
    assert delete_response.status_code == 200
    assert len(client.get("/api/library/items").get_json()) == 1


def test_library_tracker_validates_progress_ranges(client):
    response = client.post(
        "/api/library/items",
        json={
            "title": "One Piece",
            "media_type": "manga",
            "status": "in_progress",
            "current_unit": 1200,
            "total_units": 1100,
        },
    )
    assert response.status_code == 400
    assert response.get_json()["error"] == "Current progress cannot be higher than total progress."


def test_notes_support_tags_and_pinning(client):
    create_response = client.post(
        "/api/notes/",
        json={"title": "Reference", "tags": "python, flask", "is_pinned": 1, "content": "Docs and snippets"},
    )
    assert create_response.status_code == 201
    note = create_response.get_json()["note"]
    assert note["tags"] == "python, flask"
    assert note["is_pinned"] == 1

    listed = client.get("/api/notes/?pinned=1&q=flask")
    assert listed.status_code == 200
    payload = listed.get_json()
    assert len(payload) == 1
    assert payload[0]["id"] == note["id"]


def test_journal_entries_can_be_updated_and_filtered(client):
    create_response = client.post(
        "/api/journal/",
        json={"title": "Deep work", "tags": "study, focus", "content": "Strong session", "mood_score": 8},
    )
    assert create_response.status_code == 201
    entry = create_response.get_json()["entry"]

    update_response = client.put(
        f"/api/journal/{entry['id']}",
        json={"title": "Deep work revised", "content": "Strong session with revision", "tags": "study", "mood_score": 9},
    )
    assert update_response.status_code == 200
    updated = update_response.get_json()["entry"]
    assert updated["title"] == "Deep work revised"
    assert updated["mood_score"] == 9

    filtered = client.get("/api/journal/?q=revised&mood=9")
    assert filtered.status_code == 200
    assert len(filtered.get_json()) == 1


def test_calendar_event_supports_goal_and_project_links(client):
    project = client.post("/api/projects/", json={"name": "Calendar-linked project"}).get_json()["project"]
    goal = client.post("/api/goals/", json={"title": "Calendar-linked goal"}).get_json()["goal"]

    create_response = client.post(
        "/api/calendar/events",
        json={
            "title": "Planning block",
            "start_at": "2026-05-19T09:00",
            "end_at": "2026-05-19T10:00",
            "project_id": project["id"],
            "goal_id": goal["id"],
        },
    )
    assert create_response.status_code == 201

    week_payload = client.get("/api/calendar/week?start=2026-05-19").get_json()
    matching_day = next(day for day in week_payload["days"] if day["date"] == "2026-05-19")
    event = matching_day["events"][0]
    assert event["project_id"] == project["id"]
    assert event["goal_id"] == goal["id"]
    assert event["project_name"] == "Calendar-linked project"
    assert event["goal_title"] == "Calendar-linked goal"


def test_recurring_calendar_events_expand_into_week(client):
    create_response = client.post(
        "/api/calendar/events",
        json={
            "title": "Morning review",
            "start_at": "2026-05-18T08:00",
            "end_at": "2026-05-18T08:30",
            "recurrence": "daily",
            "recurrence_until": "2026-05-20",
        },
    )
    assert create_response.status_code == 201

    week_payload = client.get("/api/calendar/week?start=2026-05-18").get_json()
    matches = [
        day["date"]
        for day in week_payload["days"]
        if any(event["title"] == "Morning review" for event in day["events"])
    ]
    assert matches == ["2026-05-18", "2026-05-19", "2026-05-20"]


def test_project_milestone_flow(client):
    project = client.post("/api/projects/", json={"name": "Milestone project"}).get_json()["project"]
    project_id = project["id"]

    create_response = client.post(
        f"/api/projects/{project_id}/milestones",
        json={"title": "Prototype", "due_date": "2026-06-01"},
    )
    assert create_response.status_code == 201
    milestone = create_response.get_json()["milestone"]

    update_response = client.put(
        f"/api/projects/{project_id}/milestones/{milestone['id']}",
        json={"status": "completed"},
    )
    assert update_response.status_code == 200
    updated = update_response.get_json()["milestone"]
    assert updated["status"] == "completed"
    assert updated["completed_at"] is not None

    project_detail = client.get(f"/api/projects/{project_id}").get_json()
    assert len(project_detail["milestones"]) == 1


def test_profile_seed_and_exports_work(client):
    traits_response = client.get("/api/profile/traits")
    beliefs_response = client.get("/api/profile/beliefs")
    skills_response = client.get("/api/profile/skills")
    export_response = client.get("/api/settings/export/json")

    assert traits_response.status_code == 200
    assert len(traits_response.get_json()) >= 1
    assert beliefs_response.status_code == 200
    assert len(beliefs_response.get_json()) >= 1
    assert skills_response.status_code == 200
    assert len(skills_response.get_json()) >= 1

    assert export_response.status_code == 200
    body = export_response.data.decode("utf-8")
    assert '"beliefs"' in body
    assert '"skills"' in body


def test_skill_crud_flow(client):
    create_response = client.post(
        "/api/profile/skills",
        json={
            "name": "TypeScript",
            "category": "language",
            "proficiency": 72,
            "experience_level": "advanced",
            "notes": "Frontend app work",
        },
    )
    assert create_response.status_code == 201
    skill = create_response.get_json()["skill"]

    update_response = client.put(
        f"/api/profile/skills/{skill['id']}",
        json={"proficiency": 80, "notes": "React + tooling"},
    )
    assert update_response.status_code == 200
    updated = update_response.get_json()["skill"]
    assert updated["proficiency"] == 80
    assert updated["notes"] == "React + tooling"

    skills = client.get("/api/profile/skills").get_json()
    assert any(item["id"] == skill["id"] for item in skills)


def test_profile_traits_and_beliefs_support_crud_and_reordering(client):
    baseline_traits = client.get("/api/profile/traits").get_json()
    create_trait = client.post(
        "/api/profile/traits",
        json={"name": "Adaptability", "category": "behavioral", "score": 77},
    )
    assert create_trait.status_code == 201
    trait = create_trait.get_json()["trait"]
    assert trait["name"] == "Adaptability"

    update_trait = client.put(
        f"/api/profile/traits/{trait['id']}",
        json={"name": "Adaptive Execution", "category": "behavioral", "score": 81},
    )
    assert update_trait.status_code == 200
    assert update_trait.get_json()["trait"]["score"] == 81

    reorder_traits = client.post(
        "/api/profile/traits/reorder",
        json={"ids": [trait["id"], *[item["id"] for item in baseline_traits]]},
    )
    assert reorder_traits.status_code == 200
    assert client.get("/api/profile/traits").get_json()[0]["id"] == trait["id"]

    delete_trait = client.delete(f"/api/profile/traits/{trait['id']}")
    assert delete_trait.status_code == 200

    baseline_beliefs = client.get("/api/profile/beliefs").get_json()
    create_belief = client.post(
        "/api/profile/beliefs",
        json={"title": "Ship Weekly", "text": "Every week should produce visible output."},
    )
    assert create_belief.status_code == 201
    belief = create_belief.get_json()["belief"]

    update_belief = client.put(
        f"/api/profile/beliefs/{belief['id']}",
        json={"title": "Ship Continuously", "text": "Visible output compounds faster than hidden preparation."},
    )
    assert update_belief.status_code == 200
    assert update_belief.get_json()["belief"]["title"] == "Ship Continuously"

    reorder_beliefs = client.post(
        "/api/profile/beliefs/reorder",
        json={"ids": [belief["id"], *[item["id"] for item in baseline_beliefs]]},
    )
    assert reorder_beliefs.status_code == 200
    assert client.get("/api/profile/beliefs").get_json()[0]["id"] == belief["id"]

    delete_belief = client.delete(f"/api/profile/beliefs/{belief['id']}")
    assert delete_belief.status_code == 200


def test_settings_system_restore_and_maintenance_endpoints(client):
    seed_export = client.get("/api/settings/export/json")
    assert seed_export.status_code == 200
    exported_payload = seed_export.get_json()

    created_task = client.post("/api/tasks/", json={"title": "Temporary task"}).get_json()["task"]
    assert created_task["title"] == "Temporary task"

    restore_response = client.post("/api/settings/import/json", json={"data": exported_payload})
    assert restore_response.status_code == 200
    restored_tasks = client.get("/api/tasks/?status=pending").get_json()
    assert all(task["title"] != "Temporary task" for task in restored_tasks)

    orphan_attachment = client.post(
        "/api/life/attachments",
        json={"entity_type": "note", "entity_id": 9999, "title": "Dangling", "url": "example.com"},
    )
    assert orphan_attachment.status_code == 201

    system_response = client.get("/api/settings/system")
    assert system_response.status_code == 200
    system_payload = system_response.get_json()
    assert system_payload["orphan_attachment_count"] >= 1

    prune_response = client.post("/api/settings/maintenance/attachments/prune", json={})
    assert prune_response.status_code == 200
    assert len(prune_response.get_json()["removed_ids"]) >= 1

    reset_response = client.post("/api/settings/maintenance/profile/reset", json={})
    assert reset_response.status_code == 200
    reset_counts = reset_response.get_json()["counts"]
    assert reset_counts["traits"] >= 1
    assert reset_counts["beliefs"] >= 1
    assert reset_counts["skills"] >= 1

    vacuum_response = client.post("/api/settings/maintenance/database/vacuum", json={})
    assert vacuum_response.status_code == 200


def test_calendar_event_lifecycle_and_week_payload(client):
    create_response = client.post(
        "/api/calendar/events",
        json={
            "title": "Algorithms Study",
            "category": "study",
            "location": "Desk",
            "start_at": "2026-05-18T10:00",
            "end_at": "2026-05-18T11:30",
            "description": "Graphs and DP",
        },
    )
    assert create_response.status_code == 201
    event = create_response.get_json()["event"]

    week_response = client.get("/api/calendar/week?start=2026-05-18")
    assert week_response.status_code == 200
    payload = week_response.get_json()
    assert payload["week_start"] == "2026-05-18"
    monday = payload["days"][0]
    assert monday["date"] == "2026-05-18"
    assert any(item["id"] == event["id"] for item in monday["events"])

    update_response = client.put(
        f"/api/calendar/events/{event['id']}",
        json={"end_at": "2026-05-18T12:00"},
    )
    assert update_response.status_code == 200
    assert update_response.get_json()["event"]["end_at"].startswith("2026-05-18 12:00")

    delete_response = client.delete(f"/api/calendar/events/{event['id']}")
    assert delete_response.status_code == 200
    refreshed = client.get("/api/calendar/week?start=2026-05-18").get_json()
    assert not any(item["id"] == event["id"] for item in refreshed["days"][0]["events"])
