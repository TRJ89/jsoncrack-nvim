#!/usr/bin/env python3
"""Validate the checked-in, offline Neovim preview distribution."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import subprocess
import sys
from pathlib import Path, PurePosixPath


ALLOWED_ASSET_EXTENSIONS = {
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
ASSET_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class DistributionError(Exception):
    pass


def require_regular_file(path: Path, description: str) -> bytes:
    try:
        file_stat = path.lstat()
    except FileNotFoundError as error:
        raise DistributionError(f"{description} is missing: {path}") from error
    if not stat.S_ISREG(file_stat.st_mode):
        raise DistributionError(f"{description} is not a regular file: {path}")
    try:
        return path.read_bytes()
    except OSError as error:
        raise DistributionError(f"{description} cannot be read: {path}") from error


def safe_relative_path(value: object, description: str) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value:
        raise DistributionError(f"{description} has an invalid path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise DistributionError(f"{description} has an invalid path")
    if path.as_posix() != value:
        raise DistributionError(f"{description} has a non-canonical path")
    return path


def load_json(path: Path, description: str) -> dict:
    raw = require_regular_file(path, description)
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DistributionError(f"{description} is not valid UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise DistributionError(f"{description} must be a JSON object")
    return value


def validate_manifest(dist: Path) -> tuple[set[str], int]:
    manifest = load_json(dist / "manifest.json", "asset manifest")
    if set(manifest) != {"version", "routes"} or manifest.get("version") != 1:
        raise DistributionError("asset manifest has an unsupported shape or version")
    routes = manifest.get("routes")
    if not isinstance(routes, dict) or routes.get("/") != "index.html":
        raise DistributionError("asset manifest must map / to index.html")

    targets: set[str] = set()
    for route, target in routes.items():
        if not isinstance(route, str) or not isinstance(target, str):
            raise DistributionError("asset manifest routes must contain string paths")
        safe_target = safe_relative_path(target, "manifest target")
        if route == "/":
            if target != "index.html":
                raise DistributionError("the root manifest route must target index.html")
        elif route.startswith("/assets/"):
            name = route.removeprefix("/assets/")
            if not ASSET_NAME.fullmatch(name) or ".." in name or target != f"assets/{name}":
                raise DistributionError("asset manifest contains an invalid asset route")
            if Path(name).suffix.lower() not in ALLOWED_ASSET_EXTENSIONS:
                raise DistributionError("asset manifest contains an unsupported asset type")
        else:
            raise DistributionError("asset manifest contains an unsupported route")

        target_path = dist.joinpath(*safe_target.parts)
        if not target_path.exists() and not target_path.is_symlink():
            raise DistributionError(f"manifest route points to missing file: {target}")
        require_regular_file(target_path, "manifest target")
        targets.add(target)

    asset_dir = dist / "assets"
    if not asset_dir.is_dir() or asset_dir.is_symlink():
        raise DistributionError("distribution assets directory is missing or unsafe")
    asset_files: set[str] = set()
    for entry in asset_dir.iterdir():
        name = entry.name
        if name.lower().endswith(".map"):
            raise DistributionError(f"source map is forbidden in the distribution: assets/{name}")
        if not ASSET_NAME.fullmatch(name) or ".." in name:
            raise DistributionError(f"distribution contains an unsafe asset name: {name}")
        if Path(name).suffix.lower() not in ALLOWED_ASSET_EXTENSIONS:
            raise DistributionError(f"distribution contains an unsupported asset: assets/{name}")
        require_regular_file(entry, "distribution asset")
        asset_files.add(f"assets/{name}")

    manifested_assets = targets - {"index.html"}
    extra_assets = asset_files - manifested_assets
    missing_assets = manifested_assets - asset_files
    if extra_assets:
        raise DistributionError("unmanifested asset(s): " + ", ".join(sorted(extra_assets)))
    if missing_assets:
        missing = sorted(missing_assets)[0]
        raise DistributionError(f"manifest route points to missing file: {missing}")

    html = (dist / "index.html").read_text(encoding="utf-8")
    if re.search(r"(?:src|href)=[\"'](?:https?:)?//", html, re.IGNORECASE):
        raise DistributionError("production HTML references an external asset")
    for match in re.finditer(r"(?:src|href)=[\"']([^\"']+)[\"']", html):
        reference = match.group(1)
        if reference.startswith("/assets/") and reference not in routes:
            raise DistributionError("production HTML references an asset outside the manifest")
    return targets, len(asset_files)


def validate_notices(dist: Path) -> tuple[int, int]:
    notices = load_json(dist / "THIRD-PARTY-NOTICES.json", "third-party notices")
    if notices.get("version") != 1:
        raise DistributionError("third-party notices have an unsupported version")
    packages = notices.get("packages")
    artifacts = notices.get("artifacts")
    if not isinstance(packages, list) or not packages:
        raise DistributionError("third-party notices do not list runtime packages")
    if not isinstance(artifacts, list):
        raise DistributionError("third-party notices have an invalid artifact list")

    referenced: set[str] = set()
    for package in packages:
        if not isinstance(package, dict) or not all(
            isinstance(package.get(field), str) and package[field]
            for field in ("name", "version", "license", "lockPath")
        ):
            raise DistributionError("third-party notices contain an incomplete package record")
        if not isinstance(package.get("resolved"), str) or not isinstance(
            package.get("integrity"), str
        ):
            raise DistributionError("third-party notices omit lockfile provenance")
        license_files = package.get("licenseFiles")
        if not isinstance(license_files, list) or not license_files:
            raise DistributionError(f"third-party package has no license text: {package['name']}@{package['version']}")
        for license_file in license_files:
            referenced.add(validate_license_file(dist, license_file, package["name"]))

    for artifact in artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("name"), str):
            raise DistributionError("third-party notices contain an invalid asset attribution")
        license_files = artifact.get("licenseFiles")
        if not isinstance(license_files, list) or not license_files:
            raise DistributionError(f"attributed asset has no license text: {artifact['name']}")
        for license_file in license_files:
            referenced.add(validate_license_file(dist, license_file, artifact["name"]))

    license_directory = dist / "licenses"
    if not license_directory.is_dir() or license_directory.is_symlink():
        raise DistributionError("distribution license directory is missing or unsafe")
    actual: set[str] = set()
    for entry in license_directory.iterdir():
        require_regular_file(entry, "license text")
        actual.add(f"licenses/{entry.name}")
    if referenced != actual:
        unreferenced = sorted(actual - referenced)
        missing = sorted(referenced - actual)
        details = []
        if missing:
            details.append("missing: " + ", ".join(missing))
        if unreferenced:
            details.append("unreferenced: " + ", ".join(unreferenced))
        raise DistributionError("license text mapping does not match files (" + "; ".join(details) + ")")

    require_regular_file(dist / "THIRD-PARTY-NOTICES.md", "human-readable third-party notices")
    return len(packages), len(referenced)


def validate_license_file(dist: Path, value: object, owner: str) -> str:
    if not isinstance(value, dict):
        raise DistributionError(f"license text mapping is invalid for {owner}")
    relative = safe_relative_path(value.get("file"), f"license text mapping for {owner}")
    if len(relative.parts) != 2 or relative.parts[0] != "licenses":
        raise DistributionError(f"license text mapping is invalid for {owner}")
    if not re.fullmatch(r"[0-9a-f]{64}\.txt", relative.name):
        raise DistributionError(f"license text filename is not content-addressed for {owner}")
    path = dist.joinpath(*relative.parts)
    raw = require_regular_file(path, "license text is missing")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != value.get("sha256") or relative.name != f"{digest}.txt":
        raise DistributionError(f"license text hash does not match its notice mapping: {relative}")
    return relative.as_posix()


def validate_tracked_inventory(root: Path, dist: Path) -> None:
    listing = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z", "--", "dist"],
        capture_output=True,
        check=False,
    )
    if listing.returncode:
        raise DistributionError("could not read tracked distribution files from Git")
    tracked = {value.decode("utf-8") for value in listing.stdout.split(b"\0") if value}
    actual = {
        path.relative_to(root).as_posix()
        for path in dist.rglob("*")
        if path.is_file() or path.is_symlink()
    }
    missing = tracked - actual
    untracked = actual - tracked
    if missing or untracked:
        details = []
        if missing:
            details.append("missing tracked files: " + ", ".join(sorted(missing)))
        if untracked:
            details.append("new untracked files: " + ", ".join(sorted(untracked)))
        raise DistributionError("distribution inventory differs from Git (" + "; ".join(details) + ")")

    diff = subprocess.run(
        ["git", "-C", str(root), "diff", "--quiet", "HEAD", "--", "dist"],
        check=False,
    )
    if diff.returncode == 1:
        raise DistributionError("generated distribution differs from the committed Git version")
    if diff.returncode:
        raise DistributionError("could not compare distribution with Git HEAD")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="repository root to validate (defaults to this script's repository)",
    )
    parser.add_argument(
        "--check-tracked",
        action="store_true",
        help="require the generated distribution to match the Git index and HEAD",
    )
    args = parser.parse_args()
    root = args.root.resolve()
    dist = root / "dist"

    try:
        require_regular_file(root / "LICENSE", "project LICENSE")
        # Walk the full tree first so maps and symlinks cannot hide outside assets/.
        if not dist.is_dir() or dist.is_symlink():
            raise DistributionError("distribution directory is missing or unsafe")
        for path in dist.rglob("*"):
            if path.is_symlink():
                raise DistributionError(f"distribution contains a symbolic link: {path.relative_to(dist)}")
            if path.is_file() and path.suffix.lower() == ".map":
                raise DistributionError(f"source map is forbidden in the distribution: {path.relative_to(dist)}")
        _, asset_count = validate_manifest(dist)
        package_count, license_count = validate_notices(dist)
        if args.check_tracked:
            validate_tracked_inventory(root, dist)
    except (DistributionError, OSError) as error:
        print(f"distribution check failed: {error}", file=sys.stderr)
        return 1

    print(
        f"distribution OK: {asset_count} manifested assets, "
        f"{package_count} runtime package instances, {license_count} license texts"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
