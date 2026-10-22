import json
import os
import stat
import tempfile
import threading
import time
import unittest
from pathlib import Path

from server.snapshot import MAX_FILE_SIZE, SnapshotStore, Target


class SnapshotStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.path = self.root / "target.json"
        self.path.write_bytes(b'{"a":1}')
        self.store = SnapshotStore(Target(str(self.path), "json", "target.json"))

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_reads_a_bounded_regular_file_as_snapshot(self):
        snapshot = self.store.read()

        self.assertEqual(snapshot["protocol"], 1)
        self.assertEqual(snapshot["format"], "json")
        self.assertEqual(snapshot["display_name"], "target.json")
        self.assertEqual(snapshot["status"], "ok")
        self.assertEqual(snapshot["text"], '{"a":1}')
        self.assertTrue(snapshot["revision"])

    def test_same_content_has_same_revision_independent_of_mtime(self):
        first = self.store.read()
        before = self.path.stat()
        os.utime(self.path, ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000_000))

        self.assertEqual(first["revision"], self.store.read()["revision"])

    def test_format_contributes_to_revision(self):
        json_revision = self.store.read()["revision"]
        yaml_store = SnapshotStore(Target(str(self.path), "yaml", "target.json"))

        self.assertNotEqual(json_revision, yaml_store.read()["revision"])

    def test_same_metadata_different_content_changes_revision(self):
        before = self.store.read()
        original_stat = self.path.stat()
        self.path.write_bytes(b'{"a":2}')
        os.utime(self.path, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))

        self.assertNotEqual(before["revision"], self.store.read()["revision"])

    def test_one_mebibyte_is_allowed(self):
        self.path.write_bytes((b" " * (MAX_FILE_SIZE - 2)) + b"{}")

        snapshot = self.store.read()

        self.assertEqual(snapshot["status"], "ok")
        self.assertEqual(len(snapshot["text"].encode("utf-8")), MAX_FILE_SIZE)

    def test_one_byte_over_limit_is_rejected(self):
        self.path.write_bytes((b" " * MAX_FILE_SIZE) + b" ")

        snapshot = self.store.read()

        self.assertEqual(snapshot["status"], "error")
        self.assertEqual(snapshot["error"]["code"], "FILE_TOO_LARGE")

    def test_utf8_bom_is_removed(self):
        self.path.write_bytes(b"\xef\xbb\xbf{\"a\":1}")

        snapshot = self.store.read()

        self.assertEqual(snapshot["status"], "ok")
        self.assertEqual(snapshot["text"], '{"a":1}')

    def test_invalid_utf8_is_rejected_without_source_leakage(self):
        secret = b"fixture-secret-do-not-leak"
        self.path.write_bytes(b"{\"secret\":\"" + secret + b"\",\"bad\":\xff}")

        snapshot = self.store.read()

        self.assertEqual(snapshot["status"], "error")
        self.assertEqual(snapshot["error"]["code"], "INVALID_ENCODING")
        self.assertNotIn(secret.decode("ascii"), json.dumps(snapshot))
        self.assertNotIn(str(self.path), json.dumps(snapshot))

    def test_missing_target_reports_safe_error_and_recovers(self):
        secret = "fixture-secret-do-not-leak"
        self.path.write_text('{"secret":"' + secret + '"}', encoding="utf-8")
        self.path.unlink()

        missing = self.store.read()

        self.assertEqual(missing["status"], "error")
        self.assertEqual(missing["error"]["code"], "FILE_UNAVAILABLE")
        self.assertNotIn(secret, json.dumps(missing))
        self.assertNotIn(str(self.path), json.dumps(missing))

        self.path.write_bytes(b'{"recovered":true}')
        recovered = self.store.read()
        self.assertEqual(recovered["status"], "ok")
        self.assertEqual(recovered["text"], '{"recovered":true}')
        self.assertNotEqual(missing["revision"], recovered["revision"])

    def test_unreadable_target_reports_safe_error_and_recovers(self):
        if os.geteuid() == 0:
            self.skipTest("permission checks require a non-root process")

        self.path.write_bytes(b'{"secret":"fixture-secret-do-not-leak"}')
        self.path.chmod(0)
        try:
            denied = self.store.read()
            self.assertEqual(denied["status"], "error")
            self.assertEqual(denied["error"]["code"], "FILE_UNAVAILABLE")
            self.assertNotIn("fixture-secret-do-not-leak", json.dumps(denied))
        finally:
            self.path.chmod(stat.S_IRUSR | stat.S_IWUSR)

        self.assertEqual(self.store.read()["status"], "ok")

    def test_atomic_regular_file_replacement_is_readable(self):
        replacement = self.root / "replacement.json"
        replacement.write_bytes(b'{"atomic":true}')
        os.replace(replacement, self.path)

        snapshot = self.store.read()

        self.assertEqual(snapshot["status"], "ok")
        self.assertEqual(snapshot["text"], '{"atomic":true}')

    def test_final_symlink_replacement_is_rejected_without_leaking_target(self):
        outside = self.root / "outside.json"
        outside.write_text('{"secret":"fixture-secret-do-not-leak"}', encoding="utf-8")
        self.path.unlink()
        self.path.symlink_to(outside)

        snapshot = self.store.read()

        self.assertEqual(snapshot["status"], "error")
        self.assertEqual(snapshot["error"]["code"], "TARGET_CHANGED")
        self.assertNotIn("fixture-secret-do-not-leak", json.dumps(snapshot))
        self.assertNotIn(str(outside), json.dumps(snapshot))

    def test_initial_symlink_is_resolved_once_and_later_redirection_is_rejected(self):
        actual = self.root / "actual.json"
        actual.write_text('{"initial":true}', encoding="utf-8")
        alias = self.root / "alias.json"
        alias.symlink_to(actual)
        store = SnapshotStore(Target(str(alias), "json", "alias.json"))

        initial = store.read()
        self.assertEqual(store.target.path, str(actual))
        self.assertEqual(initial["status"], "ok")
        self.assertEqual(initial["text"], '{"initial":true}')

        outside = self.root / "outside.json"
        outside.write_text('{"secret":"fixture-secret-do-not-leak"}', encoding="utf-8")
        alias.unlink()
        alias.symlink_to(outside)
        redirected = store.read()

        self.assertEqual(redirected["status"], "error")
        self.assertEqual(redirected["error"]["code"], "TARGET_CHANGED")
        self.assertNotIn("fixture-secret-do-not-leak", json.dumps(redirected))

    def test_parent_symlink_replacement_is_rejected_without_following_it(self):
        parent = self.root / "parent"
        parent.mkdir()
        target = parent / "target.json"
        target.write_bytes(b'{"inside":true}')
        store = SnapshotStore(Target(str(target), "json", "target.json"))
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "target.json").write_text(
            '{"secret":"fixture-secret-do-not-leak"}', encoding="utf-8"
        )
        moved = self.root / "parent-real"
        parent.rename(moved)
        parent.symlink_to(outside, target_is_directory=True)

        snapshot = store.read()

        self.assertEqual(snapshot["status"], "error")
        self.assertEqual(snapshot["error"]["code"], "TARGET_CHANGED")
        self.assertNotIn("fixture-secret-do-not-leak", json.dumps(snapshot))

    def test_fifo_and_directory_replacements_fail_without_blocking(self):
        fifo = self.root / "fifo.json"
        fifo.write_bytes(b"old")
        fifo_store = SnapshotStore(Target(str(fifo), "json", "fifo.json"))
        fifo.unlink()
        os.mkfifo(fifo)

        directory = self.root / "directory.json"
        directory.write_bytes(b"old")
        directory_store = SnapshotStore(Target(str(directory), "json", "directory.json"))
        directory.unlink()
        directory.mkdir()

        results = []
        worker = threading.Thread(
            target=lambda: results.extend([fifo_store.read(), directory_store.read()]),
            daemon=True,
        )
        worker.start()
        worker.join(timeout=2)

        self.assertFalse(worker.is_alive(), "special-file rejection must not block")
        self.assertEqual([r["error"]["code"] for r in results], ["FILE_UNAVAILABLE"] * 2)

    def test_read_retries_once_when_target_changes_during_read(self):
        self.path.write_bytes(b"a" * MAX_FILE_SIZE)
        import server.snapshot as snapshot_module

        original_read = snapshot_module.os.read
        changes = 0

        def changing_read(fd, size):
            nonlocal changes
            result = original_read(fd, size)
            if size > MAX_FILE_SIZE and changes < 2:
                changes += 1
                with open(self.path, "ab") as changed:
                    changed.write(b"x")
            return result

        snapshot_module.os.read = changing_read
        try:
            snapshot = self.store.read()
        finally:
            snapshot_module.os.read = original_read

        self.assertEqual(snapshot["status"], "error")
        self.assertEqual(snapshot["error"]["code"], "FILE_UNAVAILABLE")
        self.assertEqual(changes, 2)

    def test_concurrent_reads_from_one_store_are_serialized(self):
        import server.snapshot as snapshot_module

        original_read = snapshot_module.os.read
        activity_lock = threading.Lock()
        active_reads = 0
        max_active_reads = 0
        start = threading.Barrier(3)
        results = []

        def observed_read(fd, size):
            nonlocal active_reads, max_active_reads
            with activity_lock:
                active_reads += 1
                max_active_reads = max(max_active_reads, active_reads)
            try:
                time.sleep(0.02)
                return original_read(fd, size)
            finally:
                with activity_lock:
                    active_reads -= 1

        def read_snapshot():
            start.wait(timeout=1)
            results.append(self.store.read())

        snapshot_module.os.read = observed_read
        readers = [threading.Thread(target=read_snapshot, daemon=True) for _ in range(2)]
        try:
            for reader in readers:
                reader.start()
            start.wait(timeout=1)
            for reader in readers:
                reader.join(timeout=2)
        finally:
            snapshot_module.os.read = original_read

        self.assertTrue(all(not reader.is_alive() for reader in readers))
        self.assertEqual([snapshot["status"] for snapshot in results], ["ok", "ok"])
        self.assertEqual(max_active_reads, 1)

    def test_target_requires_an_absolute_path(self):
        with self.assertRaises(ValueError):
            Target("relative.json", "json", "relative.json")


if __name__ == "__main__":
    unittest.main()
