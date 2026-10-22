#!/usr/bin/env python3
"""Build and serve only the renderer's isolated Playwright fixture."""

from __future__ import annotations

import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parents[1]
DIST_ROOT = WEB_ROOT / ".renderer-dist"
HOST = "127.0.0.1"
PORT = 4173
CSP = (
    "default-src 'none'; script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; connect-src 'self'; "
    "img-src 'self' data:; font-src 'self'; worker-src 'self' blob:; "
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
)


class RendererHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(DIST_ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Content-Security-Policy", CSP)
        super().end_headers()

    def list_directory(self, path: str) -> None:
        self.send_error(404, "Directory listing is disabled")
        return None

    def log_message(self, format: str, *args: object) -> None:
        # Keep test server output free of request data.
        return None


def main() -> None:
    subprocess.run(["npm", "run", "build:renderer-test"], cwd=WEB_ROOT, check=True)
    server = ThreadingHTTPServer((HOST, PORT), RendererHandler)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
