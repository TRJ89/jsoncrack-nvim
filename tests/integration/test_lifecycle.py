"""Lifecycle checks that exercise the installed plugin in real headless Neovim."""

from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[2]
NVIM = shutil.which("nvim") or "/usr/bin/nvim"
FIXTURE = REPO_ROOT / "tests" / "fixtures" / "preview.json"
BRIDGE_LUA = REPO_ROOT / "tests" / "integration" / "nvim_bridge.lua"


def process_snapshot(pid: int) -> tuple[int, str] | None:
    try:
        stat = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
        fields = stat[stat.rfind(")") + 2 :].split()
        command = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
        return int(fields[1]), command
    except (FileNotFoundError, ProcessLookupError, PermissionError, ValueError):
        return None


def descendants(root_pid: int) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    pending = [root_pid]
    seen = {root_pid}
    while pending:
        parent = pending.pop()
        try:
            children = Path(f"/proc/{parent}/task/{parent}/children").read_text().split()
        except (FileNotFoundError, PermissionError):
            continue
        for value in children:
            pid = int(value)
            if pid in seen:
                continue
            seen.add(pid)
            snapshot = process_snapshot(pid)
            if snapshot is None:
                continue
            found.append((pid, snapshot[1]))
            pending.append(pid)
    return found


def server_pid_for(nvim_pid: int) -> int | None:
    suffix = str((REPO_ROOT / "server" / "main.py").resolve())
    for pid, command in descendants(nvim_pid):
        if "main.py" in command and ("jsoncrack" in command or suffix in command):
            return pid
    return None


def listeners_for_pid(pid: int) -> list[int]:
    try:
        descriptors = Path(f"/proc/{pid}/fd").iterdir()
        inodes = set()
        for descriptor in descriptors:
            try:
                link = os.readlink(descriptor)
            except (FileNotFoundError, PermissionError):
                continue
            if link.startswith("socket:[") and link.endswith("]"):
                inodes.add(link[8:-1])
    except (FileNotFoundError, PermissionError):
        return []

    listeners: list[int] = []
    for table in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            rows = Path(table).read_text().splitlines()[1:]
        except (FileNotFoundError, PermissionError):
            continue
        for row in rows:
            fields = row.split()
            if len(fields) < 10 or fields[3] != "0A" or fields[9] not in inodes:
                continue
            address, port_hex = fields[1].split(":")
            if table.endswith("tcp") and address != "0100007F":
                continue
            listeners.append(int(port_hex, 16))
    return listeners


def listener_accepts(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.08):
            return True
    except OSError:
        return False


def wait_until(predicate, timeout: float, description: str):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.02)
    raise AssertionError(f"timed out waiting for {description}")


class NvimBridge:
    def __init__(
        self,
        temporary: tempfile.TemporaryDirectory,
        *,
        plugin_root: Path = REPO_ROOT,
        environment: dict[str, str] | None = None,
    ):
        self.temporary = temporary
        self.root = Path(temporary.name)
        self.plugin_root = plugin_root
        self.target = self.root / FIXTURE.name
        shutil.copyfile(FIXTURE, self.target)
        self.address = self.root / "nvim.sock"
        self.notification_log = self.root / "notifications.log"
        self._environment = os.environ.copy()
        self._environment.update(
            {
                "JSONCRACK_PLUGIN_ROOT": str(plugin_root),
                "JSONCRACK_NOTIFICATION_LOG": str(self.notification_log),
            }
        )
        if environment:
            self._environment.update(environment)
        self.process = subprocess.Popen(
            [
                NVIM,
                "--headless",
                "--noplugin",
                "-u",
                "NONE",
                "--listen",
                str(self.address),
                str(self.target),
                "-c",
                f"lua dofile([=[{BRIDGE_LUA}]=])",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=self._environment,
        )
        self.owned_server_pids: set[int] = set()
        try:
            wait_until(lambda: self.address.exists(), 5.0, "Neovim RPC socket")
            wait_until(lambda: self.rpc("luaeval('1 + 1')", timeout=1.0) == "2", 5.0, "Neovim RPC readiness")
        except BaseException:
            self.close()
            raise

    def rpc(self, expression: str, timeout: float = 3.0) -> str:
        result = subprocess.run(
            [NVIM, "--server", str(self.address), "--remote-expr", expression],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            raise RuntimeError(f"nvim RPC failed: {result.stderr.strip()}")
        return result.stdout.strip()

    def call(self, function: str, argument: str | None = None, timeout: float = 3.0) -> str:
        if argument is None:
            expression = f"luaeval('_G.JsonCrackBridge.{function}()')"
        else:
            literal = "'" + argument.replace("'", "''") + "'"
            expression = f"luaeval('_G.JsonCrackBridge.{function}(_A)', {literal})"
        return self.rpc(expression, timeout=timeout)

    def command(self, action: str) -> None:
        self.call("command", action)

    def quit(self) -> None:
        subprocess.run(
            [NVIM, "--server", str(self.address), "--remote-send", ":qa!<CR>"],
            capture_output=True,
            text=True,
            timeout=2.0,
            check=False,
        )

    def start_server(self) -> tuple[int, int]:
        self.command("toggle")
        pid = wait_until(
            lambda: server_pid_for(self.process.pid),
            5.0,
            "Python child process",
        )
        self.owned_server_pids.add(pid)
        port = wait_until(
            lambda: next(iter(listeners_for_pid(pid)), None),
            5.0,
            "loopback listener",
        )
        wait_until(lambda: listener_accepts(port), 2.0, "listener accepting connections")
        return pid, port

    def notifications(self) -> str:
        try:
            return self.notification_log.read_text(encoding="utf-8")
        except FileNotFoundError:
            return ""

    def stop_server(self, pid: int, port: int, timeout: float = 2.0) -> float:
        started = time.monotonic()
        wait_until(
            lambda: process_snapshot(pid) is None and not listener_accepts(port),
            timeout,
            "owned server process and listener to stop",
        )
        return time.monotonic() - started

    def close(self) -> None:
        if self.process.poll() is None:
            try:
                self.command("stop")
            except (RuntimeError, subprocess.TimeoutExpired, OSError):
                pass
            try:
                self.process.wait(timeout=1.5)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                try:
                    self.process.wait(timeout=1.0)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=1.0)

        for pid in tuple(self.owned_server_pids):
            snapshot = process_snapshot(pid)
            if snapshot is None:
                continue
            command = snapshot[1]
            expected_path = str((self.plugin_root / "server" / "main.py").resolve())
            if "main.py" not in command or expected_path not in command:
                continue
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                continue
            try:
                wait_until(lambda: process_snapshot(pid) is None, 1.0, "owned Python child cleanup")
            except AssertionError:
                snapshot = process_snapshot(pid)
                if snapshot is not None and expected_path in snapshot[1]:
                    os.kill(pid, signal.SIGKILL)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            if stream is not None:
                stream.close()
        self.temporary.cleanup()


class IntegrationLifecycleTests(unittest.TestCase):
    def _bridge(self, environment: dict[str, str] | None = None) -> NvimBridge:
        temporary = tempfile.TemporaryDirectory(prefix="jsoncrack-nvim-integration-")
        self.addCleanup(temporary.cleanup)
        bridge = NvimBridge(temporary, environment=environment)
        self.addCleanup(bridge.close)
        return bridge

    def test_startup_failure_reaps_the_spawned_neovim_process(self):
        temporary = tempfile.TemporaryDirectory(prefix="jsoncrack-nvim-integration-failure-")
        self.addCleanup(temporary.cleanup)
        processes: list[subprocess.Popen] = []
        real_popen = subprocess.Popen

        def record_process(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            command = args[0] if args else kwargs.get("args", ())
            if isinstance(command, (list, tuple)) and "--listen" in command:
                processes.append(process)
            return process

        with (
            patch.object(subprocess, "Popen", side_effect=record_process),
            patch.object(sys.modules[__name__], "wait_until", side_effect=AssertionError("injected RPC readiness failure")),
        ):
            with self.assertRaisesRegex(AssertionError, "injected RPC readiness failure"):
                NvimBridge(temporary)

        self.assertEqual(len(processes), 1)
        self.assertIsNotNone(processes[0].poll(), "failed bridge construction leaked its owned Neovim process")
        self.assertEqual(descendants(processes[0].pid), [], "failed bridge construction leaked an owned child")

    def test_twenty_start_stop_cycles_reap_only_the_owned_child(self):
        bridge = self._bridge()
        for cycle in range(20):
            pid, port = bridge.start_server()
            self.assertTrue(listener_accepts(port), f"cycle {cycle + 1} did not accept")
            bridge.command("toggle")
            elapsed = bridge.stop_server(pid, port)
            self.assertLessEqual(elapsed, 2.0, f"cycle {cycle + 1} took {elapsed:.3f}s")

    def test_normal_parent_exit_closes_child_and_listener_within_two_seconds(self):
        bridge = self._bridge()
        pid, port = bridge.start_server()
        started = time.monotonic()
        bridge.quit()
        bridge.process.wait(timeout=2.0)
        elapsed = wait_until(
            lambda: time.monotonic() - started
            if process_snapshot(pid) is None and not listener_accepts(port)
            else None,
            2.0,
            "normal-exit child cleanup",
        )
        self.assertLessEqual(elapsed, 2.0)

    def test_sigkill_parent_closes_child_and_listener_within_two_seconds(self):
        bridge = self._bridge()
        pid, port = bridge.start_server()
        started = time.monotonic()
        bridge.process.kill()
        bridge.process.wait(timeout=2.0)
        elapsed = wait_until(
            lambda: time.monotonic() - started
            if process_snapshot(pid) is None and not listener_accepts(port)
            else None,
            2.0,
            "SIGKILL child cleanup",
        )
        self.assertLessEqual(elapsed, 2.0)

    def test_split_keeps_preview_until_last_view_and_rename_stops_it(self):
        bridge = self._bridge()
        pid, port = bridge.start_server()

        bridge.command("split_other")
        self.assertTrue(listener_accepts(port), "split hid the target while another split still displayed it")
        bridge.command("close_window")
        self.assertTrue(listener_accepts(port), "closing the unrelated split stopped the target preview")
        bridge.command("hide_target")
        bridge.stop_server(pid, port)

        bridge.call("edit", str(bridge.target))
        pid, port = bridge.start_server()
        renamed = bridge.root / "renamed.json"
        bridge.call("rename", str(renamed))
        bridge.stop_server(pid, port)

    def test_missing_python_and_assets_report_without_leaving_a_child(self):
        empty_path = Path(tempfile.mkdtemp(prefix="jsoncrack-empty-path-"))
        self.addCleanup(lambda: shutil.rmtree(empty_path, ignore_errors=True))
        bridge = self._bridge({"PATH": str(empty_path)})
        bridge.command("toggle")
        wait_until(lambda: "Python 3 was not found" in bridge.notifications(), 2.0, "missing-Python notification")
        self.assertIsNone(server_pid_for(bridge.process.pid))

        temporary = tempfile.TemporaryDirectory(prefix="jsoncrack-no-assets-")
        self.addCleanup(temporary.cleanup)
        plugin_root = Path(temporary.name) / "plugin"
        plugin_root.mkdir()
        for name in ("lua", "plugin", "server"):
            shutil.copytree(REPO_ROOT / name, plugin_root / name)
        missing_assets = NvimBridge(temporary, plugin_root=plugin_root)
        self.addCleanup(missing_assets.close)
        missing_assets.command("toggle")
        wait_until(
            lambda: "bundled preview assets are missing" in missing_assets.notifications(),
            2.0,
            "missing-assets notification",
        )
        self.assertIsNone(server_pid_for(missing_assets.process.pid))


if __name__ == "__main__":
    unittest.main()
