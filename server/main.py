"""stdin-driven child process entry point for the preview server."""

from __future__ import annotations

import json
import secrets
import sys
import threading
from pathlib import Path
from typing import BinaryIO


PLUGIN_ROOT = Path(__file__).resolve().parent.parent
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from server.http_server import create_server, load_assets  # noqa: E402
from server.snapshot import SnapshotStore, Target  # noqa: E402


MAX_CONFIG_LINE_BYTES = 64 * 1024
DIST_DIR = PLUGIN_ROOT / "dist"


def _read_target(stream: BinaryIO) -> Target:
    line = stream.readline(MAX_CONFIG_LINE_BYTES + 1)
    if not line:
        raise ValueError("missing startup configuration")
    if len(line) > MAX_CONFIG_LINE_BYTES:
        raise ValueError("startup configuration is too large")
    if not line.endswith(b"\n"):
        raise ValueError("startup configuration must be one complete line")
    line = line[:-1]
    if line.endswith(b"\r"):
        line = line[:-1]

    try:
        value = json.loads(line.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError):
        raise ValueError("startup configuration is invalid") from None
    if (
        not isinstance(value, dict)
        or set(value) != {"protocol", "path", "format", "display_name"}
        or type(value.get("protocol")) is not int
        or value["protocol"] != 1
        or not isinstance(value.get("path"), str)
        or not isinstance(value.get("format"), str)
        or not isinstance(value.get("display_name"), str)
    ):
        raise ValueError("startup configuration is invalid")
    try:
        return Target(value["path"], value["format"], value["display_name"])
    except (TypeError, ValueError):
        raise ValueError("startup configuration is invalid") from None


def _write_error() -> None:
    message = {
        "event": "error",
        "code": "START_FAILED",
        "message": "The preview server could not start.",
    }
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    """Read one target, emit ready, then serve until stdin reaches EOF."""
    try:
        target = _read_target(sys.stdin.buffer)
        assets = load_assets(DIST_DIR)
        store = SnapshotStore(target)
        token = secrets.token_hex(32)
        server = create_server(store, assets, token)
    except Exception:
        _write_error()
        return 1

    serve_thread = threading.Thread(
        target=server.serve_forever,
        kwargs={"poll_interval": 0.05},
        name="jsoncrack-http-server",
        daemon=True,
    )
    try:
        serve_thread.start()
    except Exception:
        server.server_close()
        _write_error()
        return 1

    ready = {
        "event": "ready",
        "protocol": 1,
        "port": server.server_address[1],
        "token": token,
    }
    sys.stdout.write(json.dumps(ready, separators=(",", ":")) + "\n")
    sys.stdout.flush()

    try:
        while sys.stdin.buffer.read(4096):
            # The initial line configures the child; remaining stdin is a liveness pipe.
            pass
    except Exception:
        # Loss of the parent pipe has the same lifecycle meaning as EOF.
        pass
    finally:
        server.shutdown()
        serve_thread.join(timeout=2.0)
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
