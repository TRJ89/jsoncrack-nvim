"""Real process and socket helpers for Python preview-server tests."""

from __future__ import annotations

import http.client
import json
import os
import selectors
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT = object()


@dataclass(frozen=True)
class Response:
    status: int
    headers: http.client.HTTPMessage
    body: bytes

    @property
    def etag(self) -> str | None:
        return self.headers.get("ETag")

    def header(self, name: str) -> str | None:
        return self.headers.get(name)


class HTTPClient:
    def __init__(self, port: int, token: str | None = None):
        self.port = port
        self.token = token
        self.sockets: list[socket.socket] = []

    def request(
        self,
        method: str,
        path: str,
        headers: Iterable[tuple[str, str]] = (),
        body: bytes = b"",
        timeout: float = 3.0,
    ) -> Response:
        sock = socket.create_connection(("127.0.0.1", self.port), timeout=timeout)
        self.sockets.append(sock)
        try:
            sock.settimeout(timeout)
            request_headers = list(headers)
            if not any(name.lower() == "host" for name, _ in request_headers):
                request_headers.append(("Host", f"127.0.0.1:{self.port}"))
            if not any(name.lower() == "connection" for name, _ in request_headers):
                request_headers.append(("Connection", "close"))
            wire = [f"{method} {path} HTTP/1.1\r\n".encode("ascii")]
            wire.extend(
                name.encode("ascii") + b": " + value.encode("latin-1") + b"\r\n"
                for name, value in request_headers
            )
            wire.append(b"\r\n")
            wire.append(body)
            sock.sendall(b"".join(wire))
            response = http.client.HTTPResponse(sock)
            response.begin()
            payload = b"" if method == "HEAD" else response.read()
            return Response(response.status, response.headers, payload)
        finally:
            sock.close()
            self.sockets.remove(sock)

    def get(
        self,
        path: str,
        *,
        token: str | None | object = _DEFAULT,
        etag: str | None = None,
        origin: str | None = None,
        host: str | None = None,
        extra_headers: Iterable[tuple[str, str]] = (),
    ) -> Response:
        headers = list(extra_headers)
        if host is not None:
            headers.append(("Host", host))
        if token is _DEFAULT:
            token = self.token
        if token is not None:
            headers.append(("Authorization", f"Bearer {token}"))
        if etag is not None:
            headers.append(("If-None-Match", etag))
        if origin is not None:
            headers.append(("Origin", origin))
        return self.request("GET", path, headers)

    def snapshot(
        self,
        *,
        token: str | None | object = _DEFAULT,
        etag: str | None = None,
        origin: str | None = None,
        host: str | None = None,
        extra_headers: Iterable[tuple[str, str]] = (),
    ) -> Response:
        return self.get(
            "/api/snapshot",
            token=token,
            etag=etag,
            origin=origin,
            host=host,
            extra_headers=extra_headers,
        )

    def open_raw(self, payload: bytes = b"") -> socket.socket:
        sock = socket.create_connection(("127.0.0.1", self.port), timeout=3.0)
        self.sockets.append(sock)
        if payload:
            sock.sendall(payload)
        return sock

    def close(self) -> None:
        for sock in self.sockets[:]:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()
            self.sockets.remove(sock)


class ServerProcess:
    def __init__(self, temporary: tempfile.TemporaryDirectory, process: subprocess.Popen):
        self.temporary = temporary
        self.process = process
        self.pid = process.pid
        self.plugin_root = Path(temporary.name) / "plugin"
        self.dist_path = self.plugin_root / "dist"
        self.stdin = process.stdin
        self.stdout = process.stdout
        self.stderr = process.stderr
        self._stdout_buffer = bytearray()
        self.ready: dict | None = None
        self.client: HTTPClient | None = None

    def send_configuration(self, target: Path, chunks: tuple[bytes, ...] | None = None) -> None:
        target = Path(target)
        suffix = target.suffix.lower()
        config = json.dumps(
            {
                "protocol": 1,
                "path": str(target),
                "format": "yaml" if suffix in (".yaml", ".yml") else "json",
                "display_name": target.name,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8") + b"\n"
        pieces = chunks or (config,)
        for index, piece in enumerate(pieces):
            self.stdin.write(piece)
            self.stdin.flush()
            if chunks and index + 1 < len(pieces):
                time.sleep(0.05)

    def read_stdout_line(self, timeout: float = 4.0) -> bytes:
        deadline = time.monotonic() + timeout
        selector = selectors.DefaultSelector()
        selector.register(self.stdout, selectors.EVENT_READ)
        try:
            while True:
                newline = self._stdout_buffer.find(b"\n")
                if newline >= 0:
                    line = bytes(self._stdout_buffer[:newline])
                    del self._stdout_buffer[: newline + 1]
                    return line
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("child did not write a stdout line")
                if not selector.select(remaining):
                    raise TimeoutError("child did not write a stdout line")
                chunk = os.read(self.stdout.fileno(), 4096)
                if not chunk:
                    raise EOFError("child closed stdout before a complete line")
                self._stdout_buffer.extend(chunk)
        finally:
            selector.close()

    def wait_ready(self, timeout: float = 4.0) -> dict:
        self.ready = json.loads(self.read_stdout_line(timeout).decode("utf-8"))
        if self.ready.get("event") == "ready":
            self.client = HTTPClient(self.ready["port"], self.ready["token"])
        return self.ready

    def read_stdout_available(self) -> bytes:
        output = bytearray(self._stdout_buffer)
        self._stdout_buffer.clear()
        selector = selectors.DefaultSelector()
        selector.register(self.stdout, selectors.EVENT_READ)
        try:
            while selector.select(0):
                chunk = os.read(self.stdout.fileno(), 4096)
                if not chunk:
                    break
                output.extend(chunk)
        finally:
            selector.close()
        return bytes(output)

    def read_stderr_available(self) -> bytes:
        selector = selectors.DefaultSelector()
        selector.register(self.stderr, selectors.EVENT_READ)
        output = bytearray()
        try:
            while selector.select(0):
                chunk = os.read(self.stderr.fileno(), 4096)
                if not chunk:
                    break
                output.extend(chunk)
        finally:
            selector.close()
        return bytes(output)

    def close(self) -> None:
        if self.client is not None:
            self.client.close()
        if self.stdin is not None and not self.stdin.closed:
            self.stdin.close()
        try:
            self.process.wait(timeout=3.0)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=2.0)
        for stream in (self.stdout, self.stderr):
            if stream is not None:
                stream.close()
        self.temporary.cleanup()


def launch_server(dist_dir: Path | None) -> ServerProcess:
    temporary = tempfile.TemporaryDirectory(prefix="jsoncrack-http-")
    root = Path(temporary.name)
    plugin_root = root / "plugin"
    shutil.copytree(REPO_ROOT / "server", plugin_root / "server", ignore=shutil.ignore_patterns("__pycache__"))
    if dist_dir is not None and Path(dist_dir).exists():
        shutil.copytree(Path(dist_dir), plugin_root / "dist", symlinks=True)
    working_dir = root / "unrelated-cwd"
    working_dir.mkdir()
    try:
        process = subprocess.Popen(
            [sys.executable, str(plugin_root / "server" / "main.py")],
            cwd=working_dir,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
    except BaseException:
        temporary.cleanup()
        raise
    return ServerProcess(temporary, process)


def start_server(target: Path, dist_dir: Path | None) -> ServerProcess:
    child = launch_server(dist_dir)
    try:
        child.send_configuration(target)
        child.wait_ready()
        return child
    except BaseException:
        child.close()
        raise


def make_dist(directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    assets = directory / "assets"
    assets.mkdir(exist_ok=True)
    (directory / "index.html").write_text(
        '<!doctype html><html><body><script src="/assets/app-abc123.js"></script></body></html>',
        encoding="utf-8",
    )
    (assets / "app-abc123.js").write_text("document.documentElement.dataset.ready='yes';", encoding="utf-8")
    (assets / "app-def456.css").write_text("body { color: white; }", encoding="utf-8")
    (directory / "manifest.json").write_text(
        json.dumps(
            {
                "version": 1,
                "routes": {
                    "/": "index.html",
                    "/assets/app-abc123.js": "assets/app-abc123.js",
                    "/assets/app-def456.css": "assets/app-def456.css",
                },
            }
        ),
        encoding="utf-8",
    )
    return directory
