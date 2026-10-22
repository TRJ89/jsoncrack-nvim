import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CHECK_SCRIPT = REPOSITORY_ROOT / "scripts" / "check_dist.py"


class DistributionCheckTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.dist = self.root / "dist"
        (self.root / "LICENSE").write_text("MIT terms\n", encoding="utf-8")
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "licenses").mkdir()
        (self.dist / "index.html").write_text("<!doctype html>\n", encoding="utf-8")
        (self.dist / "assets" / "app-abc123.js").write_text("export {};\n", encoding="utf-8")
        license_bytes = b"MIT terms\n"
        license_name = hashlib.sha256(license_bytes).hexdigest() + ".txt"
        (self.dist / "licenses" / license_name).write_bytes(license_bytes)
        (self.dist / "THIRD-PARTY-NOTICES.md").write_text("Third-party notices\n", encoding="utf-8")
        license_bytes = (self.dist / "licenses" / license_name).read_bytes()
        (self.dist / "THIRD-PARTY-NOTICES.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "packages": [
                        {
                            "name": "example",
                            "version": "1.0.0",
                            "license": "MIT",
                            "lockPath": "node_modules/example",
                            "resolved": "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
                            "integrity": "sha512-example",
                            "licenseFiles": [
                                {
                                    "file": "licenses/" + hashlib.sha256(license_bytes).hexdigest() + ".txt",
                                    "sha256": hashlib.sha256(license_bytes).hexdigest(),
                                }
                            ],
                        }
                    ],
                    "artifacts": [],
                }
            ),
            encoding="utf-8",
        )
        self.write_manifest({"/": "index.html", "/assets/app-abc123.js": "assets/app-abc123.js"})

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_manifest(self, routes):
        (self.dist / "manifest.json").write_text(
            json.dumps({"version": 1, "routes": routes}), encoding="utf-8"
        )

    def run_check(self):
        return self.run_check_with_options()

    def run_check_with_options(self, *options):
        return subprocess.run(
            [sys.executable, str(CHECK_SCRIPT), "--root", str(self.root), *options],
            cwd=self.root.parent,
            capture_output=True,
            text=True,
            check=False,
        )

    def assert_distribution_rejected(self, expected_diagnostic):
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(expected_diagnostic, result.stdout + result.stderr)

    def test_accepts_a_valid_distribution(self):
        result = self.run_check()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("distribution OK: 1 manifested assets, 1 runtime package instances, 1 license texts", result.stdout)

    def test_rejects_a_manifest_route_whose_file_is_missing(self):
        self.write_manifest(
            {
                "/": "index.html",
                "/assets/app-abc123.js": "assets/app-abc123.js",
                "/assets/missing.js": "assets/missing.js",
            }
        )

        self.assert_distribution_rejected("manifest route points to missing file")

    def test_rejects_an_unmanifested_asset(self):
        (self.dist / "assets" / "debug.js").write_text("console.log('debug');\n", encoding="utf-8")

        self.assert_distribution_rejected("unmanifested asset")

    def test_rejects_a_source_map_in_the_distribution(self):
        (self.dist / "assets" / "app-abc123.js.map").write_text("{}\n", encoding="utf-8")

        self.assert_distribution_rejected("source map")

    def test_rejects_a_license_reference_whose_text_is_missing(self):
        next((self.dist / "licenses").iterdir()).unlink()

        self.assert_distribution_rejected("license text is missing")

    def initialize_git_baseline(self):
        subprocess.run(["git", "init", "--quiet", str(self.root)], check=True)
        subprocess.run(["git", "-C", str(self.root), "config", "user.name", "Distribution tests"], check=True)
        subprocess.run(["git", "-C", str(self.root), "config", "user.email", "distribution@example.invalid"], check=True)
        subprocess.run(["git", "-C", str(self.root), "add", "LICENSE", "dist"], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "--quiet", "-m", "baseline"], check=True)

    def assert_tracked_check_rejected(self, expected_diagnostic):
        result = self.run_check_with_options("--check-tracked")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(expected_diagnostic, result.stdout + result.stderr)

    def test_check_tracked_accepts_a_clean_inventory(self):
        self.initialize_git_baseline()

        result = self.run_check_with_options("--check-tracked")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_check_tracked_rejects_a_new_distribution_file(self):
        self.initialize_git_baseline()
        (self.dist / "new-file.txt").write_text("not part of the build\n", encoding="utf-8")

        self.assert_tracked_check_rejected("new untracked files: dist/new-file.txt")

    def test_check_tracked_rejects_a_missing_tracked_file(self):
        extra = self.dist / "validation-evidence.txt"
        extra.write_text("tracked auxiliary distribution file\n", encoding="utf-8")
        self.initialize_git_baseline()
        extra.unlink()

        self.assert_tracked_check_rejected("missing tracked files: dist/validation-evidence.txt")

    def test_check_tracked_rejects_a_changed_tracked_file(self):
        self.initialize_git_baseline()
        (self.dist / "assets" / "app-abc123.js").write_text("export const changed = true;\n", encoding="utf-8")

        self.assert_tracked_check_rejected("generated distribution differs from the committed Git version")


if __name__ == "__main__":
    unittest.main()
