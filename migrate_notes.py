
import sqlite3

def migrate():
    conn = sqlite3.connect('lifeup.db')
    cursor = conn.cursor()

    # 1. Create project_notes table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    ''')

    # 2. Migrate existing notes from projects table
    cursor.execute('SELECT id, name, notes FROM projects WHERE notes IS NOT NULL AND notes != ""')
    rows = cursor.fetchall()

    for row in rows:
        project_id, project_name, notes_content = row
        cursor.execute(
            'INSERT INTO project_notes (project_id, title, content) VALUES (?, ?, ?)',
            (project_id, f"{project_name} General Notes", notes_content)
        )

    conn.commit()
    conn.close()
    print("Migration completed successfully.")

if __name__ == "__main__":
    migrate()
