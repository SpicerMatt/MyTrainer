"""Local-only MyTrainer server. Run with Python 3.10 or newer."""
import json
import math
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import webbrowser

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data' / 'activities.json'
GARMIN_DATA = ROOT / 'garmin_data'
LEGACY_GARMIN_DATA = ROOT.parent / 'garmin_data'
GARMIN_SCRIPT = ROOT / 'garmin_sync.py'
OLLAMA_CHAT_URL = 'http://127.0.0.1:11434/api/chat'
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'llama3.2')


def validate(items):
    from datetime import date
    if not isinstance(items, list) or len(items) > 10000:
        raise ValueError('Expected an array of up to 10,000 activities.')
    clean = []
    for item in items:
        date.fromisoformat(item['date'])
        activity = {key: str(item.get(key, '')).strip() for key in ('date', 'name', 'type', 'notes')}
        if not activity['name'] or activity['type'] not in ('Run', 'Walk', 'Ride', 'Strength', 'Other'):
            raise ValueError('Each activity needs a name and valid type.')
        for key in ('minutes', 'distance'):
            value = float(item.get(key, 0))
            if not 0 <= value <= 100000:
                raise ValueError('Duration and distance must be finite, nonnegative numbers.')
            activity[key] = value
        clean.append(activity)
    return clean


def finite_number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else 0
    except (TypeError, ValueError):
        return 0


def fitness_context():
    journal = json.loads(DATA.read_text(encoding='utf-8')) if DATA.exists() else []
    garmin_folder = GARMIN_DATA if (GARMIN_DATA / 'activities.json').exists() else LEGACY_GARMIN_DATA
    garmin_file = garmin_folder / 'activities.json'
    garmin = json.loads(garmin_file.read_text(encoding='utf-8')) if garmin_file.exists() else []
    records = []

    for item in journal:
        if isinstance(item, dict):
            records.append({
                'source': 'journal',
                'date': str(item.get('date', ''))[:32],
                'name': str(item.get('name', ''))[:120],
                'type': str(item.get('type', 'Other'))[:40],
                'duration_min': round(finite_number(item.get('minutes')), 1),
                'distance_km': round(finite_number(item.get('distance')), 2),
                'notes': str(item.get('notes', ''))[:240],
            })

    for item in garmin:
        if not isinstance(item, dict):
            continue
        activity_type = item.get('activityType')
        if isinstance(activity_type, dict):
            activity_type = activity_type.get('typeKey', 'unknown')
        records.append({
            'source': 'garmin',
            'date': str(item.get('startTimeLocal', ''))[:32],
            'name': str(item.get('activityName', ''))[:120],
            'type': str(activity_type or 'unknown')[:40],
            'duration_min': round(finite_number(item.get('duration')) / 60, 1),
            'distance_km': round(finite_number(item.get('distance')) / 1000, 2),
            'average_hr': finite_number(item.get('averageHR')) or None,
            'max_hr': finite_number(item.get('maxHR')) or None,
            'calories': finite_number(item.get('calories')) or None,
            'elevation_gain_m': finite_number(item.get('elevationGain')) or None,
        })

    records.sort(key=lambda item: item['date'], reverse=True)
    totals = {}
    by_type = {}
    for record in records:
        source = record['source']
        total = totals.setdefault(source, {'activities': 0, 'duration_min': 0, 'distance_km': 0})
        total['activities'] += 1
        total['duration_min'] += record['duration_min']
        total['distance_km'] += record['distance_km']
        type_key = f"{source}: {record['type']}"
        type_total = by_type.setdefault(type_key, {'activities': 0, 'duration_min': 0, 'distance_km': 0})
        type_total['activities'] += 1
        type_total['duration_min'] += record['duration_min']
        type_total['distance_km'] += record['distance_km']

    for total in [*totals.values(), *by_type.values()]:
        total['duration_min'] = round(total['duration_min'], 1)
        total['distance_km'] = round(total['distance_km'], 2)

    return {
        'record_window': 'All records currently stored locally; Garmin sync covers the last 90 days.',
        'totals_by_source': totals,
        'totals_by_activity_type': by_type,
        'most_recent_records': records[:60],
    }


def ask_ollama(messages):
    system_message = {
        'role': 'system',
        'content': (
            'You are a supportive fitness coach. Use the local activity data below to answer questions about '
            'training history, consistency, and practical next steps. Be clear about the dates and limits of '
            'available data; do not invent missing measurements. Keep suggestions gradual and personalized. '
            'Respond in plain text with short paragraphs and simple bullets; do not use Markdown tables. '
            'You are not a doctor: do not diagnose or prescribe treatment, and recommend a qualified clinician '
            'for injury, concerning symptoms, or medical questions. The context excludes GPS coordinates and '
            'personal identifiers.\n\n'
            f"Local fitness data (JSON):\n{json.dumps(fitness_context(), ensure_ascii=False)}"
        ),
    }
    payload = json.dumps({
        'model': OLLAMA_MODEL,
        'stream': False,
        'messages': [system_message, *messages],
    }).encode('utf-8')
    request = urllib.request.Request(
        OLLAMA_CHAT_URL, data=payload, headers={'Content-Type': 'application/json'}, method='POST'
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            result = json.loads(response.read().decode('utf-8'))
        answer = result.get('message', {}).get('content', '').strip()
        if not answer:
            raise RuntimeError('Ollama returned an empty response.')
        return answer
    except urllib.error.HTTPError as error:
        detail = error.read(1000).decode('utf-8', errors='replace')
        raise RuntimeError(f'Ollama returned HTTP {error.code}: {detail or error.reason}') from error
    except urllib.error.URLError as error:
        raise RuntimeError('Cannot reach local Ollama. Install and start Ollama, then download the configured model.') from error
    except TimeoutError as error:
        raise RuntimeError('Ollama took too long to respond. Try again or use a smaller model.') from error


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body, content_type='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/api/chat/status':
            try:
                request = urllib.request.Request('http://127.0.0.1:11434/api/tags')
                with urllib.request.urlopen(request, timeout=2) as response:
                    models = json.loads(response.read().decode('utf-8')).get('models', [])
                available = any(model.get('name', '').split(':')[0] == OLLAMA_MODEL.split(':')[0] for model in models)
                result = {'available': available, 'model': OLLAMA_MODEL}
                if not available:
                    result['setup'] = f'Run: ollama pull {OLLAMA_MODEL}'
                self.respond(200, json.dumps(result).encode())
            except (OSError, ValueError, urllib.error.URLError):
                self.respond(200, json.dumps({'available': False, 'model': OLLAMA_MODEL, 'setup': 'Install and start Ollama.'}).encode())
        elif self.path == '/api/activities':
            self.respond(200, DATA.read_bytes() if DATA.exists() else b'[]')
        elif self.path == '/api/garmin/activities':
            folder = GARMIN_DATA if (GARMIN_DATA / 'activities.json').exists() else LEGACY_GARMIN_DATA
            file = folder / 'activities.json'
            try:
                activities = json.loads(file.read_text(encoding='utf-8')) if file.exists() else []
                if not isinstance(activities, list):
                    raise ValueError('Garmin activity file must contain an array.')
                body = json.dumps({'activities': activities, 'available': file.exists()}).encode()
                self.respond(200, body)
            except (OSError, ValueError) as error:
                self.respond(500, json.dumps({'error': str(error)}).encode())
        elif re.fullmatch(r'/api/garmin/activities/\d+', self.path):
            activity_id = self.path.rsplit('/', 1)[-1]
            folder = GARMIN_DATA if (GARMIN_DATA / 'activities.json').exists() else LEGACY_GARMIN_DATA
            file = folder / f'activity_{activity_id}.json'
            if file.exists():
                self.respond(200, file.read_bytes())
            else:
                self.respond(404, b'{"error":"Activity details not found"}')
        elif self.path in ('/', '/style.css', '/app.js', '/garmin.css'):
            file = ROOT / 'static' / {'/': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/garmin.css': 'garmin.css'}[self.path]
            kind = {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript'}[file.suffix]
            self.respond(200, file.read_bytes(), kind)
        else:
            self.respond(404, b'{"error":"Not found"}')

    def do_POST(self):
        if self.path == '/api/chat':
            if self.headers.get('Origin') != 'http://' + self.headers.get('Host', ''):
                return self.respond(403, b'{"error":"Same-origin request required"}')
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 120_000:
                    raise ValueError('Invalid chat request size.')
                payload = json.loads(self.rfile.read(length))
                messages = payload.get('messages') if isinstance(payload, dict) else None
                if not isinstance(messages, list) or not 1 <= len(messages) <= 16:
                    raise ValueError('Conversation must contain 1 to 16 messages.')
                clean_messages = []
                for message in messages:
                    if not isinstance(message, dict) or message.get('role') not in ('user', 'assistant'):
                        raise ValueError('Conversation contains an invalid message.')
                    content = message.get('content')
                    if not isinstance(content, str) or not content.strip() or len(content) > 4000:
                        raise ValueError('Each message must contain 1 to 4,000 characters.')
                    clean_messages.append({'role': message['role'], 'content': content.strip()})
                answer = ask_ollama(clean_messages)
                self.respond(200, json.dumps({'answer': answer}, ensure_ascii=False).encode('utf-8'))
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self.respond(400, json.dumps({'error': str(error)}).encode())
            except RuntimeError as error:
                self.respond(502, json.dumps({'error': str(error)}).encode())
            return
        if self.path == '/api/garmin/sync':
            if self.headers.get('Origin') != 'http://' + self.headers.get('Host', ''):
                return self.respond(403, b'{"error":"Same-origin request required"}')
            try:
                result = subprocess.run(
                    [sys.executable, str(GARMIN_SCRIPT)], cwd=ROOT,
                    capture_output=True, text=True, timeout=600, check=False,
                )
                if result.returncode:
                    message = (result.stderr or result.stdout or 'Garmin sync failed.')[-3000:]
                    return self.respond(500, json.dumps({'error': message}).encode())
                self.respond(200, json.dumps({'message': result.stdout.strip()}).encode())
            except subprocess.TimeoutExpired:
                self.respond(504, b'{"error":"Garmin sync exceeded the 10 minute limit."}')
            except OSError as error:
                self.respond(500, json.dumps({'error': str(error)}).encode())
            return
        if self.path != '/api/activities':
            return self.respond(404, b'{}')
        # Require a same-origin browser request before accepting local writes.
        if self.headers.get('Origin') != 'http://' + self.headers.get('Host', ''):
            return self.respond(403, b'{"error":"Same-origin request required"}')
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 5_000_000:
                raise ValueError('Invalid upload size (maximum 5 MB).')
            activities = validate(json.loads(self.rfile.read(length)))
            DATA.parent.mkdir(exist_ok=True)
            temporary = DATA.with_suffix('.tmp')
            temporary.write_text(json.dumps(activities, indent=2), encoding='utf-8')
            os.replace(temporary, DATA)
            self.respond(200, b'{"ok":true}')
        except (ValueError, KeyError, TypeError) as error:
            self.respond(400, json.dumps({'error': str(error)}).encode())


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    url = f'http://127.0.0.1:{args.port}'
    print(f'MyTrainer running at {url}. Press Ctrl+C to stop.', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
