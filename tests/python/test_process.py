import json
import re
import tempfile
import time
import unittest
from pathlib import Path

from support import (
    decode_ready_message,
    launch_server,
    make_dist,
    parse_json_object,
    start_server,
)


class ServerProcessTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="jsoncrack-process-test-")
        self.root = Path(self.temporary.name)
        self.target = self.root / "fixture.json"
        self.target.write_text('{"secret":"fixture-secret"}', encoding="utf-8")
        self.dist = make_dist(self.root / "dist")
        self.addCleanup(self.temporary.cleanup)

    def _own(self, child):
        self.addCleanup(child.close)
        return child

    def test_stdin_config_is_read_across_chunks_and_ready_is_one_json_line(self):
        child = self._own(launch_server(self.dist))
        config = json.dumps(
            {
                "protocol": 1,
                "path": str(self.target),
                "format": "json",
                "display_name": self.target.name,
            },
            separators=(",", ":"),
        ).encode() + b"\n"
        split = len(config) // 2

        child.stdin.write(config[:split])
        child.stdin.flush()
        time.sleep(0.05)
        child.stdin.write(config[split:])
        child.stdin.flush()
        ready_line = child.read_stdout_line()
        raw_ready = parse_json_object(ready_line)
        ready = decode_ready_message(ready_line)

        self.assertEqual(ready["event"], "ready")
        self.assertEqual(ready["protocol"], 1)
        self.assertEqual(set(raw_ready), {"event", "protocol", "port", "token"})
        self.assertGreaterEqual(ready["port"], 1)
        self.assertLessEqual(ready["port"], 65535)
        self.assertRegex(ready["token"], r"^[0-9a-f]{64}$")
        self.assertIsNone(child.process.poll())
        self.assertEqual(child.read_stdout_available(), b"")

    def test_invalid_configuration_emits_safe_error_without_paths(self):
        child = self._own(launch_server(self.dist))
        secret_path = "/fixture-secret/private.json"
        child.stdin.write(
            json.dumps(
                {
                    "protocol": 1,
                    "path": secret_path,
                    "format": "json",
                    "display_name": "private.json",
                }
            ).encode()
            + b"\n"
        )
        child.stdin.flush()

        line = child.read_stdout_line()
        error = json.loads(line.decode("utf-8"))
        code = child.process.wait(timeout=2.0)

        self.assertEqual(error["event"], "error")
        self.assertEqual(error["code"], "START_FAILED")
        self.assertNotIn(secret_path, line.decode())
        self.assertNotIn(b"fixture-secret", child.read_stderr_available())
        self.assertNotEqual(code, 0)

    def test_oversized_config_line_is_rejected_safely(self):
        child = self._own(launch_server(self.dist))
        child.stdin.write(b"{" + (b" " * 65536) + b"}\n")
        child.stdin.flush()

        error = json.loads(child.read_stdout_line().decode("utf-8"))
        code = child.process.wait(timeout=2.0)

        self.assertEqual(error["event"], "error")
        self.assertEqual(error["code"], "START_FAILED")
        self.assertLess(len(json.dumps(error)), 512)
        self.assertNotEqual(code, 0)

    def test_missing_assets_emits_safe_start_failure(self):
        child = self._own(launch_server(None))
        child.send_configuration(self.target)

        error = json.loads(child.read_stdout_line().decode("utf-8"))
        code = child.process.wait(timeout=2.0)

        self.assertEqual(error["event"], "error")
        self.assertEqual(error["code"], "START_FAILED")
        self.assertNotIn(str(self.root), json.dumps(error))
        self.assertNotEqual(code, 0)

    def test_eof_closes_listener_and_exits_child(self):
        child = self._own(start_server(self.target, self.dist))
        self.assertEqual(child.ready["event"], "ready")
        port = child.ready["port"]
        child.stdin.close()

        code = child.process.wait(timeout=3.0)

        self.assertEqual(code, 0)
        with self.assertRaises(OSError):
            import socket

            socket.create_connection(("127.0.0.1", port), timeout=0.2)

    def test_two_children_get_distinct_ports_and_tokens(self):
        first = self._own(start_server(self.target, self.dist))
        second = self._own(start_server(self.target, self.dist))

        self.assertNotEqual(first.ready["port"], second.ready["port"])
        self.assertNotEqual(first.ready["token"], second.ready["token"])
        self.assertNotEqual(first.pid, second.pid)

    def test_stdout_and_stderr_do_not_log_target_body_or_authorization(self):
        child = self._own(start_server(self.target, self.dist))
        response = child.client.snapshot()
        self.assertEqual(response.status, 200)
        self.assertIn(b"fixture-secret", response.body)

        self.assertNotIn(b"fixture-secret", child.read_stdout_available())
        self.assertNotIn(b"fixture-secret", child.read_stderr_available())
        self.assertNotIn(child.ready["token"].encode(), child.read_stdout_available())
        self.assertNotIn(child.ready["token"].encode(), child.read_stderr_available())


if __name__ == "__main__":
    unittest.main()
