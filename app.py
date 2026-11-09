"""Local-only MyTrainer server. Run with Python 3.10 or newer."""
import json
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import webbrowser

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data' / 'activities.json'


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


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body, content_type='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/api/activities':
            self.respond(200, DATA.read_bytes() if DATA.exists() else b'[]')
        elif self.path in ('/', '/style.css', '/app.js'):
            file = ROOT / 'static' / {'/': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js'}[self.path]
            kind = {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript'}[file.suffix]
            self.respond(200, file.read_bytes(), kind)
        else:
            self.respond(404, b'{"error":"Not found"}')

    def do_POST(self):
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
