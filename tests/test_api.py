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
