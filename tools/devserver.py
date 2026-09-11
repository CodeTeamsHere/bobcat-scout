"""Local preview server for Bobcat Scout.

Plain `python -m http.server` sends no Cache-Control, so the browser
heuristically caches app.js and keeps running the previous build after an
edit — which looks exactly like "my fix did nothing". This serves the same
files with no-store, so a reload always picks up the current source.

    python tools/devserver.py [port]      # default 8000
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print('Bobcat Scout dev server (no-store) on http://localhost:%d' % port)
    ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
