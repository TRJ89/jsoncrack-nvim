"""Bounded, serialized snapshots of one fixed local file."""

from __future__ import annotations

import errno
import hashlib
import os
import stat
import threading
from dataclasses import dataclass, field


MAX_FILE_SIZE = 1_048_576
_ERROR_MESSAGES = {
    "FILE_UNAVAILABLE": "The target file is unavailable.",
    "FILE_TOO_LARGE": "The target file exceeds the 1 MiB limit.",
    "INVALID_ENCODING": "The target file is not valid UTF-8.",
    "TARGET_CHANGED": "The target path changed after preview started.",
}


def _directory_open_flags() -> int:
    return (
        getattr(os, "O_PATH", os.O_RDONLY)
        | os.O_DIRECTORY
        | os.O_NOFOLLOW
        | getattr(os, "O_CLOEXEC", 0)
    )


def _open_parent_directory_chain(path: str) -> tuple[int, tuple[tuple[int, int], ...]]:
    """Open path parents from root and return their descriptor and identities."""
    parts = [part for part in path.split(os.path.sep) if part]
    if not parts:
        raise OSError(errno.EINVAL, "path does not name a file")

    flags = _directory_open_flags()
    directory_fd = os.open(os.path.sep, flags)
    identities = []
    try:
        root_info = os.fstat(directory_fd)
        identities.append((root_info.st_dev, root_info.st_ino))
        for component in parts[:-1]:
            child_fd = os.open(component, flags, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = child_fd
            info = os.fstat(directory_fd)
            identities.append((info.st_dev, info.st_ino))
        return directory_fd, tuple(identities)
    except BaseException:
        os.close(directory_fd)
        raise


class _SnapshotFailure(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Target:
    """The absolute path and display metadata for one preview target.

    The requested path is resolved once and ``path`` is then fixed to that
    physical location. The requested spelling is retained so later symlink
    redirection can be detected.
    """

    path: str
    format: str
    display_name: str
    _requested_path: str = field(init=False, repr=False, compare=False)
    _parent_identities: tuple[tuple[int, int], ...] = field(
        init=False, repr=False, compare=False
    )

    def __post_init__(self) -> None:
        if not isinstance(self.path, str) or not os.path.isabs(self.path):
            raise ValueError("target path must be absolute")
        if "\x00" in self.path:
            raise ValueError("target path is invalid")
        if self.format not in ("json", "yaml"):
            raise ValueError("target format must be json or yaml")
        if (
            not isinstance(self.display_name, str)
            or not self.display_name
            or "/" in self.display_name
            or "\x00" in self.display_name
        ):
            raise ValueError("display name must be a basename")

        requested_path = self.path
        try:
            resolved_path = os.path.realpath(requested_path, strict=True)
        except (OSError, ValueError):
            raise ValueError("target path must resolve to an existing file") from None
        if resolved_path == os.path.sep:
            raise ValueError("target path must name a file")

        try:
            parent_fd, parent_identities = _open_parent_directory_chain(resolved_path)
        except OSError:
            raise ValueError("target parent path cannot be opened safely") from None
        else:
            os.close(parent_fd)

        object.__setattr__(self, "_requested_path", requested_path)
        object.__setattr__(self, "path", resolved_path)
        object.__setattr__(self, "_parent_identities", parent_identities)


class SnapshotStore:
    """Read one fixed target and return the HTTP snapshot payload shape."""

    def __init__(self, target: Target):
        if not isinstance(target, Target):
            raise TypeError("target must be a Target")
        self.target = target
        self._read_lock = threading.Lock()

    def read(self) -> dict:
        """Read the current target, retrying once if it changes mid-read."""
        with self._read_lock:
            for _attempt in range(2):
                try:
                    content, changed = self._read_attempt()
                except _SnapshotFailure as failure:
                    return self._error_snapshot(failure.code)
                if not changed:
                    return self._content_snapshot(content)
            return self._error_snapshot("FILE_UNAVAILABLE")

    def _read_attempt(self) -> tuple[bytes, bool]:
        self._assert_requested_path_unchanged()
        descriptor = self._open_fixed_target()
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode):
                raise _SnapshotFailure("FILE_UNAVAILABLE")
            content = self._read_limited(descriptor)
            after = os.fstat(descriptor)
        except _SnapshotFailure:
            raise
        except OSError:
            raise _SnapshotFailure("FILE_UNAVAILABLE") from None
        finally:
            os.close(descriptor)

        self._assert_requested_path_unchanged()
        current_descriptor = self._open_fixed_target()
        try:
            current = os.fstat(current_descriptor)
            if not stat.S_ISREG(current.st_mode):
                raise _SnapshotFailure("FILE_UNAVAILABLE")
        except _SnapshotFailure:
            raise
        except OSError:
            raise _SnapshotFailure("FILE_UNAVAILABLE") from None
        finally:
            os.close(current_descriptor)

        changed = (
            self._metadata(before) != self._metadata(after)
            or self._metadata(after) != self._metadata(current)
        )
        return content, changed

    def _read_limited(self, descriptor: int) -> bytes:
        chunks = []
        remaining = MAX_FILE_SIZE + 1
        while remaining:
            try:
                chunk = os.read(descriptor, remaining)
            except OSError:
                raise _SnapshotFailure("FILE_UNAVAILABLE") from None
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _open_fixed_target(self) -> int:
        """Open each component relative to a pinned directory, without links."""
        path_parts = self.target.path.split(os.path.sep)
        parts = [part for part in path_parts if part]
        if not parts:
            raise _SnapshotFailure("FILE_UNAVAILABLE")

        file_flags = (
            os.O_RDONLY
            | os.O_NOFOLLOW
            | os.O_NONBLOCK
            | getattr(os, "O_CLOEXEC", 0)
        )
        try:
            directory_fd, identities = _open_parent_directory_chain(self.target.path)
        except OSError as exc:
            raise self._open_failure(exc) from None
        if identities != self.target._parent_identities:
            os.close(directory_fd)
            raise _SnapshotFailure("TARGET_CHANGED")

        try:
            try:
                return os.open(parts[-1], file_flags, dir_fd=directory_fd)
            except OSError as exc:
                raise self._open_failure(exc) from None
        finally:
            os.close(directory_fd)

    @staticmethod
    def _open_failure(exc: OSError) -> _SnapshotFailure:
        if exc.errno in (errno.ELOOP, errno.ENOTDIR):
            return _SnapshotFailure("TARGET_CHANGED")
        return _SnapshotFailure("FILE_UNAVAILABLE")

    def _assert_requested_path_unchanged(self) -> None:
        try:
            current_path = os.path.realpath(self.target._requested_path, strict=True)
        except FileNotFoundError:
            raise _SnapshotFailure("FILE_UNAVAILABLE") from None
        except OSError as exc:
            if exc.errno in (errno.ELOOP, errno.ENOTDIR):
                raise _SnapshotFailure("TARGET_CHANGED") from None
            raise _SnapshotFailure("FILE_UNAVAILABLE") from None
        except ValueError:
            raise _SnapshotFailure("FILE_UNAVAILABLE") from None
        if current_path != self.target.path:
            raise _SnapshotFailure("TARGET_CHANGED")

    @staticmethod
    def _metadata(info: os.stat_result) -> tuple[int, int, int, int, int, int]:
        return (
            info.st_dev,
            info.st_ino,
            info.st_size,
            info.st_mtime_ns,
            info.st_ctime_ns,
            stat.S_IFMT(info.st_mode),
        )

    def _content_snapshot(self, content: bytes) -> dict:
        if len(content) > MAX_FILE_SIZE:
            return self._error_snapshot("FILE_TOO_LARGE", content)
        try:
            text = content.decode("utf-8-sig", errors="strict")
        except UnicodeDecodeError:
            return self._error_snapshot("INVALID_ENCODING", content)

        return {
            "protocol": 1,
            "revision": self._revision("ok", "", text.encode("utf-8")),
            "format": self.target.format,
            "display_name": self.target.display_name,
            "status": "ok",
            "text": text,
        }

    def _error_snapshot(self, code: str, content: bytes = b"") -> dict:
        message = _ERROR_MESSAGES[code]
        return {
            "protocol": 1,
            "revision": self._revision("error", code, content),
            "format": self.target.format,
            "display_name": self.target.display_name,
            "status": "error",
            "error": {"code": code, "message": message},
        }

    def _revision(self, status: str, error_code: str, content: bytes) -> str:
        digest = hashlib.sha256()
        for value in (
            b"snapshot-v1",
            self.target.format.encode("ascii"),
            status.encode("ascii"),
            error_code.encode("ascii"),
        ):
            digest.update(len(value).to_bytes(4, "big"))
            digest.update(value)
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
        return digest.hexdigest()
