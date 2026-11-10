# MyTrainer

A local fitness dashboard that combines Garmin workouts and manual entries in one activity history. The Python server uses the standard library; Garmin sync requires Python 3.12+ and the package in `requirements.txt`.

## First-time setup on Windows

From the `MyTrainer` folder in PowerShell:

```powershell
py -m pip install -r requirements.txt
[Environment]::SetEnvironmentVariable('GARMIN_PERSONAL_API_KEY', (Read-Host 'Paste Garmin Personal API key'), 'User')
```

Close and reopen PowerShell so the environment variable is available, then start the app:

```powershell
py app.py
```

The browser opens at `http://127.0.0.1:8000`. In **Activities**, select **Sync Garmin** to download activities from the last 90 days. Garmin workouts and manual entries appear together, and both contribute to weekly totals and the chart. Select **Details** on a Garmin activity to inspect its summary and full record. Sync also writes JSON and CSV files for other tools.

Manual logging is optional. Use it for workouts Garmin did not record; do not re-enter a Garmin-recorded workout manually, or it will appear twice in totals.

## Local fitness coach

Install Ollama for Windows from [ollama.com/download/windows](https://ollama.com/download/windows), then open a new PowerShell window and download the default model:

```powershell
ollama pull llama3.2
```

Start or leave Ollama running, then start MyTrainer with `py app.py` and open **Coach**. The app sends activity totals and up to 60 recent summaries to Ollama on `127.0.0.1`; GPS coordinates and account identifiers are excluded. Chat history exists only in the open browser tab and is cleared when you clear the conversation or close the tab. To use another installed model, set `OLLAMA_MODEL` in your environment before starting the app.

To run without opening a browser, use `py app.py --no-browser`. To change the port, use `py app.py --port 8001`. Stop the server with Ctrl+C.

## Local files and privacy

- Garmin exports: `garmin_data/` (ignored by Git)
- Journal entries: `data/activities.json` (ignored by Git)
- Garmin API key: Windows user environment; never put it in a file or commit

The server listens only on your computer. Garmin records can contain sensitive health and location data. Use one browser tab when editing the journal; simultaneous edits are not merged.

The old workspace-level `garmin_sync.py` remains as a compatibility command and forwards to this folder's implementation. Existing exports in the old workspace-level `garmin_data/` directory are shown until a new sync creates this project's `garmin_data/` directory.
