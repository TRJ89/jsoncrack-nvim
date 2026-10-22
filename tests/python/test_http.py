import json
import select
import tempfile
import threading
import time
import unittest
from pathlib import Path

from server.http_server import create_server, load_assets
from server.snapshot import SnapshotStore, Target
from support import HTTPClient, make_dist, start_server


CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self' blob:; "
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
)


class CountingStore:
    def __init__(self, value):
        self.value = value
        self.read_count = 0

    def read(self):
        self.read_count += 1
        return self.value


class HTTPServerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="jsoncrack-http-test-")
        self.root = Path(self.temporary.name)
        self.target = self.root / "fixture.json"
        self.target.write_text('{"secret":"fixture-secret"}', encoding="utf-8")
        self.dist = make_dist(self.root / "dist")
        self.child = start_server(self.target, self.dist)
        self.addCleanup(self.temporary.cleanup)
        self.addCleanup(self.child.close)
        self.assertEqual(self.child.ready.get("event"), "ready")
        self.client = self.child.client

    def _assert_security_headers(self, response):
        self.assertEqual(response.header("X-Content-Type-Options"), "nosniff")
        self.assertEqual(response.header("Referrer-Policy"), "no-referrer")
        self.assertEqual(response.header("Content-Security-Policy"), CSP)
        self.assertIsNone(response.header("Access-Control-Allow-Origin"))

    def _direct_server(self, store, assets=None, token="d" * 64):
        assets = assets if assets is not None else load_assets(self.dist)
        server = create_server(store, assets, token)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        client = HTTPClient(server.server_address[1], token)

        def cleanup():
            client.close()
            server.shutdown()
            thread.join(timeout=2.0)
            server.server_close()

        self.addCleanup(cleanup)
        return server, client

    def test_load_assets_maps_only_manifested_html_and_assets(self):
        assets = load_assets(self.dist)

        self.assertEqual(
            set(assets),
            {"/", "/assets/app-abc123.js", "/assets/app-def456.css"},
        )
        self.assertEqual(assets["/"], self.dist / "index.html")

    def test_manifest_source_map_and_license_are_not_served(self):
        (self.dist / "LICENSE").write_text("license-secret", encoding="utf-8")
        (self.dist / "assets" / "app-abc123.js.map").write_text("{}", encoding="utf-8")

        for path in ("/manifest.json", "/LICENSE", "/assets/app-abc123.js.map"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status, 404)
                self.assertNotIn(b"license-secret", response.body)
                self._assert_security_headers(response)

    def test_manifest_rejects_symlinked_assets_and_manifest(self):
        assets_dir = self.dist / "assets"
        javascript = assets_dir / "app-abc123.js"
        outside = self.root / "outside.js"
        outside.write_text("outside", encoding="utf-8")
        javascript.unlink()
        javascript.symlink_to(outside)
        with self.assertRaises(ValueError):
            load_assets(self.dist)
        javascript.unlink()
        javascript.write_text("inside", encoding="utf-8")

        manifest = self.dist / "manifest.json"
        saved = self.root / "manifest-saved.json"
        manifest.rename(saved)
        manifest.symlink_to(saved)
        with self.assertRaises(ValueError):
            load_assets(self.dist)

    def test_manifest_rejects_source_map_license_and_path_traversal_routes(self):
        cases = (
            ("/assets/app-abc123.js.map", "assets/app-abc123.js.map"),
            ("/LICENSE", "LICENSE"),
            ("/assets/%252e%252e/secret.js", "assets/secret.js"),
        )
        for route, filename in cases:
            with self.subTest(route=route):
                value = {
                    "version": 1,
                    "routes": {"/": "index.html", route: filename},
                }
                (self.dist / "manifest.json").write_text(json.dumps(value), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_assets(self.dist)
        make_dist(self.dist)

    def test_get_and_head_serve_html_with_matching_headers_and_no_head_body(self):
        get = self.client.get("/")
        head = self.client.request("HEAD", "/", [("Host", f"127.0.0.1:{self.client.port}")])

        self.assertEqual(get.status, 200)
        self.assertIn(b"<!doctype html>", get.body)
        self.assertTrue((get.header("Content-Type") or "").startswith("text/html"))
        self.assertEqual(head.status, 200)
        self.assertEqual(head.body, b"")
        self.assertEqual(head.header("Content-Length"), str(len(get.body)))
        self._assert_security_headers(get)
        self._assert_security_headers(head)

    def test_api_snapshot_get_and_head_require_auth_and_return_no_head_body(self):
        response = self.client.snapshot()
        head = self.client.request(
            "HEAD",
            "/api/snapshot",
            [
                ("Host", f"127.0.0.1:{self.client.port}"),
                ("Authorization", f"Bearer {self.child.ready['token']}"),
            ],
        )
        denied = self.client.snapshot(token=None)

        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(response.body)["text"], '{"secret":"fixture-secret"}')
        self.assertEqual(head.status, 200)
        self.assertEqual(head.body, b"")
        self.assertEqual(head.header("Content-Length"), str(len(response.body)))
        self.assertEqual(denied.status, 401)
        self.assertNotIn(b"fixture-secret", denied.body)
        self._assert_security_headers(response)
        self._assert_security_headers(head)
        self._assert_security_headers(denied)

    def test_authentication_precedes_etag_and_does_not_read_target(self):
        revision = self.child.client.snapshot()
        store = CountingStore(
            {
                "protocol": 1,
                "revision": "known-revision",
                "format": "json",
                "display_name": "fixture.json",
                "status": "ok",
                "text": "fixture-secret",
            }
        )
        _, client = self._direct_server(store)

        denied = client.snapshot(token=None, etag=revision.etag)

        self.assertEqual(denied.status, 401)
        self.assertEqual(store.read_count, 0)
        self.assertNotIn(b"fixture-secret", denied.body)

    def test_snapshot_returns_304_only_after_authentication_and_matching_etag(self):
        first = self.client.snapshot()
        unchanged = self.client.snapshot(etag=first.etag)
        denied = self.client.snapshot(token=None, etag=first.etag)

        self.assertEqual(first.status, 200)
        self.assertTrue(first.etag)
        self.assertEqual(unchanged.status, 304)
        self.assertEqual(unchanged.body, b"")
        self.assertEqual(denied.status, 401)
        self._assert_security_headers(unchanged)

    def test_input_error_is_http_200_and_does_not_leak_path_or_body(self):
        self.target.write_bytes(b'{"secret":"fixture-secret", "bad":\xff}')

        response = self.client.snapshot()

        payload = json.loads(response.body)
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["error"]["code"], "INVALID_ENCODING")
        self.assertNotIn(b"fixture-secret", response.body)
        self.assertNotIn(str(self.target).encode(), response.body)

    def test_unknown_paths_queries_and_encoded_traversal_are_not_served(self):
        for path in (
            "/unknown",
            "/?unknown=1",
            "/api/snapshot?path=/etc/passwd",
            "/assets/%2e%2e/index.html",
            "/assets/%252e%252e/index.html",
            "/assets/..%252findex.html",
        ):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status, 404)
                self._assert_security_headers(response)

    def test_non_get_and_head_methods_return_405_and_close_with_security_headers(self):
        for method in ("POST", "PUT", "DELETE", "OPTIONS", "PATCH"):
            with self.subTest(method=method):
                response = self.client.request(
                    method,
                    "/api/snapshot",
                    [
                        ("Host", f"127.0.0.1:{self.client.port}"),
                        ("Authorization", f"Bearer {self.child.ready['token']}"),
                        ("Content-Length", "5"),
                    ],
                    body=b"hello",
                )
                self.assertEqual(response.status, 405)
                self.assertEqual(response.header("Connection"), "close")
                self._assert_security_headers(response)

    def test_invalid_duplicate_and_nonlocal_hosts_and_origins_are_forbidden(self):
        port = self.client.port
        token = self.child.ready["token"]
        requests = (
            self.client.snapshot(host="example.test"),
            self.client.request(
                "GET",
                "/api/snapshot",
                [
                    ("Host", f"127.0.0.1:{port}"),
                    ("Host", f"127.0.0.1:{port}"),
                    ("Authorization", f"Bearer {token}"),
                ],
            ),
            self.client.snapshot(origin="http://evil.test"),
            self.client.snapshot(origin="null"),
        )

        for response in requests:
            self.assertEqual(response.status, 403)
            self._assert_security_headers(response)

    def test_same_origin_is_allowed_and_cors_headers_are_never_added(self):
        origin = f"http://127.0.0.1:{self.client.port}"
        for path in ("/", "/api/snapshot"):
            response = self.client.get(path, origin=origin)
            self.assertEqual(response.status, 200)
            self.assertIsNone(response.header("Access-Control-Allow-Origin"))

    def test_asset_swapped_to_symlink_after_manifest_load_is_rejected(self):
        assets = load_assets(self.dist)
        server, client = self._direct_server(SnapshotStore(Target(str(self.target), "json", "fixture.json")), assets)
        outside = self.root / "outside.js"
        outside.write_text("outside-secret", encoding="utf-8")
        asset = self.dist / "assets" / "app-abc123.js"
        asset.unlink()
        asset.symlink_to(outside)

        response = client.get("/assets/app-abc123.js")

        self.assertEqual(response.status, 404)
        self.assertNotIn(b"outside-secret", response.body)
        self._assert_security_headers(response)
        self.assertIsNotNone(server)

    def test_eighth_slow_connection_is_capped_ninth_is_rejected_and_server_recovers(self):
        assets = load_assets(self.dist)
        server, client = self._direct_server(
            SnapshotStore(Target(str(self.target), "json", "fixture.json")), assets
        )
        slow = [client.open_raw() for _ in range(8)]

        ninth = client.open_raw()
        ready, _, _ = select.select([ninth], [], [], 0.7)
        self.assertTrue(ready, "ninth connection should be closed promptly")
        self.assertEqual(ninth.recv(1), b"")
        ninth.close()
        client.sockets.remove(ninth)

        time.sleep(2.2)
        recovered = client.get("/")
        self.assertEqual(recovered.status, 200)
        self._assert_security_headers(recovered)


if __name__ == "__main__":
    unittest.main()
