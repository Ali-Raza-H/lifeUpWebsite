from pathlib import Path

import pytest

from app import create_app


@pytest.fixture
def app(tmp_path: Path):
    database_path = tmp_path / "test.db"
    app = create_app(
        {
            "TESTING": True,
            "DATABASE": str(database_path),
            "SECRET_KEY": "test-secret",
        }
    )
    return app


@pytest.fixture
def client(app):
    with app.test_client() as client:
        with client.session_transaction() as sess:
            sess["logged_in"] = True
        yield client
