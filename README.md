# MyTrainer

A private, local fitness journal with a weekly dashboard, activity logging, filters, deletion, and JSON import/export. Uses Python 3.10+ and a browser; no packages or account needed.

## Run on Windows

Open PowerShell in the cloned repository:

```powershell
cd D:\myProjects\PersonalCoach\MyTrainer
py app.py
```

On macOS/Linux use `python3 app.py`. The browser opens automatically. Stop with Ctrl+C. For a different port use `py app.py --port 8001`. To skip opening a browser use `--no-browser`.

Activities persist in `data/activities.json` (excluded from Git). Back up that file or use Export. The server listens only on your computer. Use a single browser tab for editing; concurrent edits are not merged.

## Garmin data

Direct Garmin sync is not connected yet: the existing `garmin_sync.py` was not in the repository. Import JSON accepts an array in this format and appends it to your journal (reimporting duplicates entries):

```json
[
  {"date":"2026-11-09","name":"Morning run","type":"Run","minutes":32,"distance":5.2,"notes":"Easy pace"}
]
```

Types: `Run`, `Walk`, `Ride`, `Strength`, `Other`. Distance is in kilometers. Import expects this format, not raw Garmin exports.

## Add your local Garmin script to Git

Your earlier Git commands failed because the parent `PersonalCoach` folder is not a Git repository. Run commands inside `MyTrainer`:

```powershell
cd D:\myProjects\PersonalCoach\MyTrainer
Copy-Item ..\garmin_sync.py .
git add garmin_sync.py
git commit -m "Add local Garmin sync script"
git branch -M main
git push -u origin main
```

Before committing, remove passwords, tokens, and personal health data from the script. Keep credentials in local environment variables instead. The copy command assumes the script is in `PersonalCoach`.
