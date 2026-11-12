#!/usr/bin/env python3
"""Build and verify schedule artifacts bound to the app's static data and generators."""

import argparse
import hashlib
import json
import shutil
import sqlite3
import subprocess
from pathlib import Path

from verify_schedule_feed import read_feed

DBS = ("bus-schedule.db", "buseireann-schedule.db", "goahead-schedule.db")
GENERATORS = (
    "scripts/gen_bus_schedule_sqlite.py",
    "scripts/gen_buseireann_schedule.py",
    "scripts/gen_goahead_schedule.py",
)
DATA_PATHS = (
    ".github/data/feed_info.txt",
    "src/data/dublinbus-*.json",
    "src/data/buseireann-*.json",
    "src/data/goahead-*.json",
    *GENERATORS,
)


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def identity(root: Path) -> dict:
    version = read_feed(root / ".github/data/feed_info.txt")["feed_version"]
    paths = [root / ".github/data/feed_info.txt", *(root / path for path in GENERATORS)]
    for operator in ("dublinbus", "buseireann", "goahead"):
        routes = root / f"src/data/{operator}-routes.json"
        if not routes.is_file():
            raise ValueError(f"Missing routes: {routes}")
        paths.extend(sorted((root / "src/data").glob(f"{operator}-*.json")))
    return {"format": 1, "feed_version": version, "inputs": {
        path.relative_to(root).as_posix(): digest(path) for path in paths
    }}


def artifact_name(root: Path) -> str:
    value = identity(root)
    fingerprint = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:16]
    return f"nta-schedules-{value['feed_version']}-{fingerprint}"


def check_db(path: Path) -> None:
    if not path.is_file():
        raise ValueError(f"Missing DB: {path}")
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as con:
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        count = con.execute("SELECT COUNT(*) FROM stop_times").fetchone()[0]
    if integrity != "ok" or count <= 0:
        raise ValueError(f"{path.name}: integrity={integrity}, stop_times={count}")
    print(f"{path.name}: {count:,} stop_times rows")


def pack(root: Path, directory: Path) -> None:
    manifest = identity(root)
    for name in DBS:
        check_db(root / "src/data" / name)
    directory.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name in DBS:
        shutil.copyfile(root / "src/data" / name, directory / name)
        hashes[name] = digest(directory / name)
    manifest["databases"] = hashes
    (directory / "manifest.json").write_text(json.dumps(manifest, sort_keys=True))


def restore(root: Path, directory: Path) -> None:
    manifest = json.loads((directory / "manifest.json").read_text())
    if {key: manifest.get(key) for key in ("format", "feed_version", "inputs")} != identity(root):
        raise ValueError("Schedule artifact does not match app data/generators")
    for name in DBS:
        if digest(directory / name) != manifest.get("databases", {}).get(name):
            raise ValueError(f"Schedule artifact checksum mismatch: {name}")
        check_db(directory / name)
    # Verify the entire bundle before replacing any local files.
    for name in DBS:
        shutil.copyfile(directory / name, root / "src/data" / name)


def schedules_changed(root: Path, base: str, head: str) -> bool:
    # Compare with the last successful deployment, not just the previous push:
    # failed/cancelled data deployments must still be retried by a later code push.
    result = subprocess.run(
        ["git", "diff", "--name-only", base, head, "--", *DATA_PATHS],
        cwd=root, check=True, capture_output=True, text=True,
    )
    return bool(result.stdout.strip())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("name", "pack", "restore", "compare", "changed"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--directory", type=Path, default=Path("/tmp/nta-schedules"))
    parser.add_argument("--base")
    parser.add_argument("--head", default="HEAD")
    args = parser.parse_args()
    if args.command == "name":
        print(artifact_name(args.root))
    elif args.command == "pack":
        pack(args.root, args.directory)
    elif args.command == "restore":
        restore(args.root, args.directory)
    elif args.command == "changed":
        if not args.base:
            parser.error("changed requires --base")
        print(str(schedules_changed(args.root, args.base, args.head)).lower())
    else:
        current = read_feed(args.root / "gtfs/feed_info.txt")
        marker = args.root / ".github/data/feed_info.txt"
        previous = read_feed(marker) if marker.exists() else {}
        for output, field in (("uuid", "feed_version"), ("feed_start", "feed_start_date"), ("feed_end", "feed_end_date")):
            for key, value in ((output, current.get(field, "")), (f"ack_{output}", previous.get(field, ""))):
                if "\n" in value or "\r" in value:
                    raise ValueError(f"Invalid multiline feed field: {field}")
                print(f"{key}={value}")
        print(f"changed={str(current['feed_version'] != previous.get('feed_version')).lower()}")
