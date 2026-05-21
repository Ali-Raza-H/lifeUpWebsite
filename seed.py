import sqlite3
from datetime import datetime, timedelta

def seed_db():
    conn = sqlite3.connect('lifeup.db')
    c = conn.cursor()

    # Clear existing data
    tables = ['calendar_events', 'skills', 'beliefs', 'traits', 'habits', 'habit_logs', 'tasks', 'projects', 'goals', 'journal_entries', 'analytics_cache']
    for t in tables:
        c.execute(f'DELETE FROM {t}')
    c.execute("DELETE FROM sqlite_sequence")

    now = datetime.now()
    future_short = (now + timedelta(days=14)).strftime('%Y-%m-%d')
    future_long = (now + timedelta(days=180)).strftime('%Y-%m-%d')
    past_1 = (now - timedelta(days=1)).strftime('%Y-%m-%d')
    past_2 = (now - timedelta(days=2)).strftime('%Y-%m-%d')

    # 1. Traits
    traits = [
        ("Systems Thinking", 95, "cognitive"),
        ("Perfectionism", 92, "behavioral"),
        ("Self-Reliance", 88, "behavioral"),
        ("Curiosity", 99, "cognitive"),
        ("Execution", 65, "behavioral"),
        ("Atonement Drive", 94, "motivational")
    ]
    c.executemany('INSERT INTO traits (name, score, category) VALUES (?, ?, ?)', traits)
    beliefs = [
        ("Uncompromising Standards", "Protect quality, but ship before perfection becomes avoidance.", 1),
        ("Self-Reliance", "Build systems that reduce friction instead of waiting for ideal conditions.", 2),
        ("Equivalent Exchange", "Meaningful progress usually requires time, focus, or comfort in return.", 3)
    ]
    c.executemany('INSERT INTO beliefs (title, text, display_order) VALUES (?, ?, ?)', beliefs)
    skills = [
        ("Python", "language", 88, "advanced", "Automation, backend, scripting", 1),
        ("JavaScript", "language", 78, "advanced", "Frontend behavior and app wiring", 2),
        ("Flask", "framework", 80, "advanced", "Small internal apps and APIs", 3),
        ("SQL / SQLite", "database", 74, "intermediate", "Schema design and queries", 4),
        ("Git", "tool", 82, "advanced", "Source control and release hygiene", 5)
    ]
    c.executemany('INSERT INTO skills (name, category, proficiency, experience_level, notes, display_order) VALUES (?, ?, ?, ?, ?, ?)', skills)

    # 2. Projects
    projects = [
        ("Amnesic OS Prototyping", "Develop core memory handling for the amnesic architecture", "active", future_short),
        ("Zyn Magic System Documentation", "Finalize physics-based ruleset for the novel", "active", future_long),
        ("Autonomous Income Stream", "Automate financial pipelines to buy time", "active", future_long)
    ]
    c.executemany('INSERT INTO projects (name, description, status, deadline) VALUES (?, ?, ?, ?)', projects)
    p_os, p_zyn, p_income = 1, 2, 3

    # 3. Goals
    goals = [
        ("Master Full-Stack Autonomous Architectures", "skill", future_long),
        ("Publish Light Novel Prologue", "short-term", future_short),
        ("Surpass Normal Human Standards", "identity", "2036-01-01")
    ]
    c.executemany('INSERT INTO goals (title, type, target_date) VALUES (?, ?, ?)', goals)
    g_arch, g_novel, g_apex = 1, 2, 3

    # 4. Tasks
    tasks = [
        ("Draft Novel Chapter 1", "Implement Law of Equivalent Exchange themes", 2, future_short, 'pending', p_zyn, g_novel, None),
        ("Refactor State Manager", "Fix memory leak in OS prototype", 1, future_short, 'in_progress', p_os, g_arch, None),
        ("Analyze Market Data", "Check automated income scripts", 3, now.strftime('%Y-%m-%d'), 'pending', p_income, None, None),
        ("System Architecture Review", "Deconstruct the current codebase", 2, past_1, 'completed', p_os, g_arch, past_1)
    ]
    c.executemany('INSERT INTO tasks (title, description, priority, due_date, status, project_id, goal_id, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', tasks)

    # 5. Habits
    habits = [
        ("Systematic Reflection", "Daily logic audit of actions vs goals", "daily", "cognitive", 5),
        ("Physical Optimization", "Exercise protocol to maintain biological hardware", "daily", "physical", 12),
        ("Deep Work (3hrs)", "Uninterrupted coding/writing without networking", "daily", "work", 3)
    ]
    c.executemany('INSERT INTO habits (name, description, frequency, category, target_streak) VALUES (?, ?, ?, ?, ?)', habits)

    # 6. Habit Logs (simulate last few days)
    habit_logs = [
        (1, past_1, 'completed'), (1, past_2, 'completed'),
        (2, past_1, 'completed'), (2, past_2, 'skipped'),
        (3, past_1, 'completed'), (3, past_2, 'completed')
    ]
    c.executemany('INSERT INTO habit_logs (habit_id, log_date, status) VALUES (?, ?, ?)', habit_logs)

    # 7. Journal Entries
    journals = [
        ("Observation: Perfectionism led to 4 hours of refactoring a perfectly working component. The 'Satisficing Rule' must be enforced. I need to define Version 1.0 criteria before opening the IDE.", 4, past_2),
        ("Hypothesis: Delegating minor tasks to AI reduces my execution bottleneck. If I can't trust people, I must trust my own custom automated systems. The architecture is holding up.", 7, past_1),
        ("The RC car project failure still proves the point: collective output is diluted by apathy. If you want supreme quality, the individual must maintain absolute control of the vision.", 6, now.strftime('%Y-%m-%d %H:%M:%S'))
    ]
    c.executemany('INSERT INTO journal_entries (content, mood_score, entry_date) VALUES (?, ?, ?)', journals)

    # 8. Calendar Events
    week_start = now - timedelta(days=now.weekday())
    events = [
        ("Deep Work Block", "Focused coding", "work", "Desk", (week_start + timedelta(days=0)).strftime('%Y-%m-%d 09:00:00'), (week_start + timedelta(days=0)).strftime('%Y-%m-%d 11:00:00')),
        ("Gym", "Strength training", "health", "Gym", (week_start + timedelta(days=1)).strftime('%Y-%m-%d 18:00:00'), (week_start + timedelta(days=1)).strftime('%Y-%m-%d 19:30:00')),
        ("Novel Writing", "Draft scene revisions", "creative", "Home", (week_start + timedelta(days=3)).strftime('%Y-%m-%d 20:00:00'), (week_start + timedelta(days=3)).strftime('%Y-%m-%d 21:30:00'))
    ]
    c.executemany('INSERT INTO calendar_events (title, description, category, location, start_at, end_at) VALUES (?, ?, ?, ?, ?, ?)', events)

    conn.commit()
    conn.close()
    print("Database seeded with Psychometric Profile data.")

if __name__ == '__main__':
    seed_db()
