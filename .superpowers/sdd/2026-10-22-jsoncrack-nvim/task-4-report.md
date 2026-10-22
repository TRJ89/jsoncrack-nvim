# Task 4: authenticated HTTP server and child process

## RED evidence

The first full Python suite used interface stubs, so the new tests reached assertions instead of failing on imports:

```text
PYTHONPATH=/home/zy/.codex/worktrees/jsoncrack-mvp/jsoncrack-nvim:/home/zy/.codex/worktrees/jsoncrack-mvp/jsoncrack-nvim/tests/python python3 -m unittest discover -s tests/python -v
Ran 43 tests in 1.059s
FAILED (failures=20, errors=2)
```

All 21 existing snapshot tests passed. The process tests observed the stub event `unimplemented` where they required a ready or safe startup-error event; HTTP tests likewise failed the startup-ready assertion. The two dependent process-test errors occurred when those tests tried to use a child that had not reached ready. The helper cleanup was tightened to close stdin even after child exit and to clean up if startup fails.

## GREEN evidence

Final full Python suite on the system Python:

```text
python3 -m unittest discover -s tests/python -v
Ran 43 tests in 7.804s
OK
```

Final full Python suite on the minimum supported Python:

```text
/tmp/jsoncrack-tools/python/cpython-3.10.18-linux-x86_64-gnu/bin/python3.10 -m unittest discover -s tests/python -v
Ran 43 tests in 7.185s
OK
```

`git diff --check` completed with exit code 0. `pgrep -af '[j]soncrack-http-'` returned no processes after the suites, confirming the test-owned children exited.

An earlier green attempt had two test errors because `http.client.HTTPResponse` tried to read the GET `Content-Length` for a HEAD response. The implementation returned the correct headers and no body; the test helper now skips body reads for HEAD, and both final suites pass.

## Files and behavior

- `server/http_server.py` validates v1 asset manifests, rejects symlinks, exposes only the manifest allowlist, and reopens each asset beneath its root with no-follow file descriptors so replacing an asset with a symlink after startup is rejected.
- The HTTP server binds `127.0.0.1` on port 0, validates one exact Host and any supplied Origin, authenticates the snapshot endpoint before reading the store or evaluating ETags, and implements GET/HEAD, 304, 404, and 405 behavior. Every response carries the specified CSP, `nosniff`, and no-referrer headers. The eight-worker semaphore and two-second socket timeout cap slow connections. Responses close connections so unread request bodies cannot be parsed as another request.
- `server/main.py` reads one UTF-8 JSON configuration line up to 64 KiB, derives `dist` from its script location, emits a single ready or safe error JSON line, generates a fresh 256-bit token, and shuts the server down after stdin EOF.
- `tests/python/support.py`, `test_http.py`, and `test_process.py` use temporary plugin layouts, real sockets, and real child processes. Their checks cover manifest validation, symlinks, auth/ETag ordering, headers and routing, connection limits and recovery, split stdin input, startup errors, EOF shutdown, distinct child credentials, and sensitive-output leakage.
- `.gitignore` now excludes Python bytecode and `__pycache__` directories so test runs do not leave generated files in the worktree.

## Self-review and concerns

The server only serves paths named in the validated manifest, never combines request paths with a filesystem root, and checks each opened static asset as a regular file. Authentication, Host, and Origin validation do not include request values in logs or error messages. The child process does not print tracebacks or startup paths. The target reader remains the reviewed `SnapshotStore` implementation from Task 3.

No unresolved behavior concern remains against Task 4. Tests use temporary assets as requested; production `dist/` validation belongs to Task 5/7.
