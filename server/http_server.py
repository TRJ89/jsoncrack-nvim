"""Authenticated, bounded HTTP server for a local preview."""

from __future__ import annotations

import json
import os
import re
import socket
import stat
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Mapping

from server.snapshot import SnapshotStore


MAX_MANIFEST_SIZE = 1_048_576
MAX_CONCURRENT_REQUESTS = 8
CONNECTION_TIMEOUT_SECONDS = 2.0
_ASSET_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_ALLOWED_SUFFIXES = {
    ".js",
    ".css",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".webp",
    ".avif",
    ".ico",
}
_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".eot": "application/vnd.ms-fontobject",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
}
CONTENT_SECURITY_POLICY = (
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self' blob:; "
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
)


def _safe_regular_file(root: Path, relative_path: str, limit: int | None = None) -> bytes:
    """Read one regular file below root without following any path symlink."""
    relative = PurePosixPath(relative_path)
    parts = relative.parts
    if (
        relative.is_absolute()
        or not parts
        or any(part in ("", ".", "..") for part in parts)
        or "\\" in relative_path
    ):
        raise ValueError("invalid asset path")

    directory_flags = (
        os.O_RDONLY
        | os.O_DIRECTORY
        | os.O_NOFOLLOW
        | getattr(os, "O_CLOEXEC", 0)
    )
    file_flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0)
    try:
        directory_fd = os.open(root, directory_flags)
    except OSError:
        raise ValueError("asset directory is unavailable") from None

    try:
        for component in parts[:-1]:
            try:
                next_fd = os.open(component, directory_flags, dir_fd=directory_fd)
            except OSError:
                raise ValueError("asset directory is unavailable") from None
            os.close(directory_fd)
            directory_fd = next_fd
        try:
            descriptor = os.open(parts[-1], file_flags, dir_fd=directory_fd)
        except OSError:
            raise ValueError("asset is unavailable") from None
    finally:
        os.close(directory_fd)

    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("asset is not a regular file")
        if limit is not None and info.st_size > limit:
            raise ValueError("asset is too large")
        chunks = []
        remaining = None if limit is None else limit + 1
        while remaining is None or remaining > 0:
            chunk = os.read(descriptor, 64 * 1024 if remaining is None else min(64 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            if remaining is not None:
                remaining -= len(chunk)
        data = b"".join(chunks)
        if limit is not None and len(data) > limit:
            raise ValueError("asset is too large")
        return data
    except OSError:
        raise ValueError("asset is unavailable") from None
    finally:
        os.close(descriptor)


def _reject_symlinks(root: Path) -> None:
    try:
        root_info = root.lstat()
    except OSError:
        raise ValueError("asset directory is unavailable") from None
    if not stat.S_ISDIR(root_info.st_mode):
        raise ValueError("asset root must be a real directory")

    def fail_walk(error: OSError) -> None:
        raise ValueError("asset tree cannot be inspected") from None

    for directory, names, files in os.walk(root, followlinks=False, onerror=fail_walk):
        current = Path(directory)
        for name in names + files:
            try:
                info = (current / name).lstat()
            except OSError:
                raise ValueError("asset tree is unavailable") from None
            if stat.S_ISLNK(info.st_mode):
                raise ValueError("asset tree cannot contain symlinks")


def _route_filename(route: object, filename: object) -> tuple[str, str]:
    if route == "/":
        if filename != "index.html":
            raise ValueError("invalid index route")
        return "/", "index.html"

    if not isinstance(route, str) or not isinstance(filename, str):
        raise ValueError("invalid asset route")
    prefix = "/assets/"
    if not route.startswith(prefix):
        raise ValueError("invalid asset route")
    name = route[len(prefix) :]
    if (
        not name
        or "/" in name
        or not _ASSET_NAME.fullmatch(name)
        or ".." in name
        or name.lower().endswith((".map", ".license", ".licence"))
        or name.lower() in ("license", "licence")
    ):
        raise ValueError("invalid asset route")
    suffix = Path(name).suffix.lower()
    if suffix not in _ALLOWED_SUFFIXES:
        raise ValueError("unsupported asset type")
    expected = f"assets/{name}"
    if filename != expected:
        raise ValueError("asset route and file do not match")
    return route, expected


def load_assets(dist_dir: Path) -> dict[str, Path]:
    """Validate dist/manifest.json and return its explicit route allowlist."""
    root = Path(os.path.abspath(os.fspath(dist_dir)))
    try:
        _reject_symlinks(root)
        manifest_bytes = _safe_regular_file(root, "manifest.json", MAX_MANIFEST_SIZE)
        manifest = json.loads(manifest_bytes.decode("utf-8", errors="strict"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid asset manifest") from None

    if (
        not isinstance(manifest, dict)
        or set(manifest) != {"version", "routes"}
        or type(manifest.get("version")) is not int
        or manifest["version"] != 1
        or not isinstance(manifest.get("routes"), dict)
        or "/" not in manifest["routes"]
    ):
        raise ValueError("invalid asset manifest")

    result: dict[str, Path] = {}
    for route, filename in manifest["routes"].items():
        safe_route, relative = _route_filename(route, filename)
        try:
            _safe_regular_file(root, relative)
        except ValueError:
            raise ValueError("invalid asset manifest") from None
        result[safe_route] = root / Path(relative)
    return result


class _BoundedHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True
    block_on_close = True
    request_queue_size = 16

    def __init__(
        self,
        server_address: tuple[str, int],
        handler: type[BaseHTTPRequestHandler],
    ) -> None:
        self._request_slots = threading.BoundedSemaphore(MAX_CONCURRENT_REQUESTS)
        super().__init__(server_address, handler)

    def get_request(self):
        request, client_address = super().get_request()
        request.settimeout(CONNECTION_TIMEOUT_SECONDS)
        return request, client_address

    def process_request(self, request, client_address):
        if not self._request_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._request_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._request_slots.release()

    def handle_error(self, request, client_address):
        # Request contents and credentials must never appear in diagnostics.
        return


def create_server(
    store: SnapshotStore,
    assets: dict[str, Path],
    token: str,
) -> HTTPServer:
    """Create an authenticated IPv4 loopback server on an OS-selected port."""
    if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{64}", token):
        raise ValueError("token must contain 256 bits of lowercase hexadecimal")
    if "/" not in assets:
        raise ValueError("index asset is required")

    copied_assets = {route: Path(path) for route, path in assets.items()}
    asset_root = copied_assets["/"].parent
    for route, path in copied_assets.items():
        try:
            relative = path.relative_to(asset_root).as_posix()
        except ValueError:
            raise ValueError("asset path must remain below the asset root") from None
        _route_filename(route, "index.html" if route == "/" else relative)

    class PreviewHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def version_string(self) -> str:
            return "JsonCrackPreview"

        def log_message(self, format: str, *args: object) -> None:
            return

        def send_error(self, code, message=None, explain=None):
            if code == 501:
                code = 405
            body = {
                400: b"Bad Request\n",
                405: b"Method Not Allowed\n",
                414: b"URI Too Long\n",
            }.get(code, b"Request Rejected\n")
            self._reply(code, body, "text/plain; charset=utf-8", head_only=getattr(self, "command", None) == "HEAD")

        def __getattr__(self, name):
            if name.startswith("do_"):
                return self._handle_unsupported_method
            raise AttributeError(name)

        def handle_expect_100(self):
            if not self._validate_host_and_origin():
                return False
            self._reply(405, b"Method Not Allowed\n", "text/plain; charset=utf-8")
            return False

        def do_GET(self):
            self._serve(head_only=False)

        def do_HEAD(self):
            self._serve(head_only=True)

        def do_POST(self):
            self._handle_unsupported_method()

        def do_PUT(self):
            self._handle_unsupported_method()

        def do_DELETE(self):
            self._handle_unsupported_method()

        def do_OPTIONS(self):
            self._handle_unsupported_method()

        def do_PATCH(self):
            self._handle_unsupported_method()

        def _reply(
            self,
            status: int,
            body: bytes,
            content_type: str | None = "text/plain; charset=utf-8",
            extra_headers: Mapping[str, str] | None = None,
            head_only: bool = False,
            content_length: int | None = None,
        ) -> None:
            self.close_connection = True
            self.send_response(status)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
            self.send_header("Connection", "close")
            if content_type is not None:
                self.send_header("Content-Type", content_type)
            if content_length is None:
                content_length = len(body)
            if status not in (204, 304) or content_length:
                self.send_header("Content-Length", str(content_length))
            for name, value in (extra_headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            if body and not head_only:
                try:
                    self.wfile.write(body)
                except (OSError, socket.timeout):
                    pass

        def _validate_host_and_origin(self) -> bool:
            if not isinstance(self.server, HTTPServer):
                self._reply(403, b"Forbidden\n")
                return False
            expected_host = f"127.0.0.1:{self.server.server_port}"
            hosts = self.headers.get_all("Host", [])
            if len(hosts) != 1 or hosts[0] != expected_host:
                self._reply(403, b"Forbidden\n")
                return False
            origins = self.headers.get_all("Origin", [])
            expected_origin = f"http://{expected_host}"
            if origins and (len(origins) != 1 or origins[0] != expected_origin):
                self._reply(403, b"Forbidden\n")
                return False
            return True

        def _serve(self, head_only: bool) -> None:
            if not self._validate_host_and_origin():
                return
            request_target = self.path
            if (
                not request_target.startswith("/")
                or "?" in request_target
                or "#" in request_target
                or "\\" in request_target
                or "\x00" in request_target
            ):
                self._reply(404, b"Not Found\n", head_only=head_only)
                return

            if request_target == "/api/snapshot":
                self._serve_snapshot(head_only)
                return

            asset_path = copied_assets.get(request_target)
            if asset_path is None:
                self._reply(404, b"Not Found\n", head_only=head_only)
                return
            try:
                relative_path = asset_path.relative_to(asset_root).as_posix()
                expected_relative = "index.html" if request_target == "/" else request_target.lstrip("/")
                if relative_path != expected_relative:
                    raise ValueError("asset route changed")
                payload = _safe_regular_file(asset_root, relative_path)
            except ValueError:
                self._reply(404, b"Not Found\n", head_only=head_only)
                return
            content_type = _CONTENT_TYPES.get(asset_path.suffix.lower())
            if content_type is None:
                self._reply(404, b"Not Found\n", head_only=head_only)
                return
            self._reply(200, payload, content_type, head_only=head_only)

        def _serve_snapshot(self, head_only: bool) -> None:
            authorization = self.headers.get_all("Authorization", [])
            if len(authorization) != 1 or authorization[0] != f"Bearer {token}":
                self._reply(
                    401,
                    b"Unauthorized\n",
                    extra_headers={"Cache-Control": "no-store"},
                    head_only=head_only,
                )
                return

            snapshot = store.read()
            payload = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            etag = f'"{snapshot["revision"]}"'
            conditionals = self.headers.get_all("If-None-Match", [])
            if len(conditionals) == 1 and conditionals[0] == etag:
                self._reply(
                    304,
                    b"",
                    content_type=None,
                    extra_headers={"Cache-Control": "no-store", "ETag": etag},
                    head_only=True,
                    content_length=0,
                )
                return
            self._reply(
                200,
                payload,
                "application/json; charset=utf-8",
                extra_headers={"Cache-Control": "no-store", "ETag": etag},
                head_only=head_only,
            )

        def _handle_unsupported_method(self):
            if not self._validate_host_and_origin():
                return
            self._reply(405, b"Method Not Allowed\n")

    try:
        return _BoundedHTTPServer(("127.0.0.1", 0), PreviewHandler)
    except OSError:
        raise ValueError("loopback HTTP server could not start") from None
