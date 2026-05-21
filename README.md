# LifeOS

Personal productivity dashboard built with Flask and SQLite.

## Production Notes

- The app now initializes and migrates its SQLite schema automatically on startup.
- Existing `lifeup.db` data is preserved; missing tables, indexes, and completion timestamp columns are added in place.
- Exports are streamed directly and do not write temp backup files into the project root.

## Run

```powershell
python -m pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000`.

## Optional Environment Variables

```powershell
$env:SECRET_KEY = "replace-this"
$env:LIFEUP_DATABASE = "lifeup.db"
$env:APP_VERSION = "1.0.0"
$env:PORT = "5000"
```

## Seed Demo Data

```powershell
python seed.py
```

## Test

```powershell
python -m pytest
```
