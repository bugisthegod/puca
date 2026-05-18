#!/usr/bin/env python3
import argparse
import csv
import json
import shutil
import sqlite3
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GTFS_DIR = ROOT / "gtfs"
DEFAULT_ZIP = Path.home() / "Downloads" / "GTFS_Realtime.zip"
NTA_ZIP_URL = "https://www.transportforireland.ie/transitData/Data/GTFS_Realtime.zip"

REQUIRED_GTFS_FILES = ("routes.txt", "trips.txt", "stop_times.txt", "feed_info.txt")

ROUTE_JSON = {
    "dublinbus": ROOT / "src/data/dublinbus-routes.json",
    "buseireann": ROOT / "src/data/buseireann-routes.json",
    "goahead": ROOT / "src/data/goahead-routes.json",
    "train": ROOT / "src/data/train-routes.json",
}

DB_FILES = {
    "dublinbus": ROOT / "src/data/bus-schedule.db",
    "buseireann": ROOT / "src/data/buseireann-schedule.db",
    "goahead": ROOT / "src/data/goahead-schedule.db",
}

AGENCY_TO_OPERATOR = {
    "7778019": "dublinbus",
    "7778020": "buseireann",
    "7778008": "buseireann",
    "7778021": "goahead",
    "7778006": "goahead",
    "7778017": "train",
}

BUS_OPERATORS = ("dublinbus", "buseireann", "goahead")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check whether a downloaded NTA GTFS feed requires JSON or DB updates.",
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument(
        "--gtfs",
        type=Path,
        default=None,
        help="Directory containing routes.txt, trips.txt, stop_times.txt and feed_info.txt.",
    )
    source.add_argument(
        "--zip",
        type=Path,
        default=None,
        help=f"GTFS zip to inspect. Defaults to {DEFAULT_ZIP} when gtfs/ is missing.",
    )
    source.add_argument(
        "--download-latest",
        action="store_true",
        help="Download the latest NTA GTFS zip to a temp directory before checking.",
    )
    return parser.parse_args()


def extract_zip(zip_path: Path, temp_dir: Path) -> Path:
    if not zip_path.exists():
        raise FileNotFoundError(f"GTFS zip not found: {zip_path}")
    gtfs_dir = temp_dir / "gtfs"
    gtfs_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            name = Path(info.filename).name
            if not name or not name.endswith(".txt"):
                continue
            with zf.open(info) as source, (gtfs_dir / name).open("wb") as target:
                shutil.copyfileobj(source, target)
    return gtfs_dir


def download_latest_zip(temp_dir: Path) -> Path:
    zip_path = temp_dir / "GTFS_Realtime.zip"
    print(f"Downloading latest GTFS zip: {NTA_ZIP_URL}")
    with urllib.request.urlopen(NTA_ZIP_URL) as response:
        with zip_path.open("wb") as f:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
    return zip_path


def resolve_gtfs_dir(args: argparse.Namespace, temp_dir: Path) -> Path:
    if args.gtfs:
        gtfs_dir = args.gtfs
    elif args.download_latest:
        return extract_zip(download_latest_zip(temp_dir), temp_dir)
    elif args.zip:
        return extract_zip(args.zip, temp_dir)
    elif all((DEFAULT_GTFS_DIR / name).exists() for name in REQUIRED_GTFS_FILES):
        gtfs_dir = DEFAULT_GTFS_DIR
    else:
        return extract_zip(DEFAULT_ZIP, temp_dir)

    missing = [name for name in REQUIRED_GTFS_FILES if not (gtfs_dir / name).exists()]
    if missing:
        raise FileNotFoundError(f"Missing GTFS files in {gtfs_dir}: {', '.join(missing)}")
    return gtfs_dir


def read_feed_info(gtfs_dir: Path) -> dict[str, str]:
    with (gtfs_dir / "feed_info.txt").open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        return {}
    return rows[0]


def load_local_route_ids(path: Path) -> set[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"Expected route JSON list: {path}")
    return {str(row["id"]) for row in data if row.get("id")}


def read_static_routes(gtfs_dir: Path) -> tuple[dict[str, set[str]], dict[str, str]]:
    static_routes = {op: set() for op in ROUTE_JSON}
    route_to_operator: dict[str, str] = {}
    with (gtfs_dir / "routes.txt").open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            operator = AGENCY_TO_OPERATOR.get(row["agency_id"])
            if not operator:
                continue
            route_id = row["route_id"]
            static_routes[operator].add(route_id)
            route_to_operator[route_id] = operator
    return static_routes, route_to_operator


def count_static_schedules(
    gtfs_dir: Path,
    route_to_operator: dict[str, str],
) -> dict[str, dict[str, int]]:
    trip_to_operator: dict[str, str] = {}
    trip_counts = {op: 0 for op in BUS_OPERATORS}
    stop_time_counts = {op: 0 for op in BUS_OPERATORS}

    with (gtfs_dir / "trips.txt").open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            operator = route_to_operator.get(row["route_id"])
            if operator in BUS_OPERATORS:
                trip_to_operator[row["trip_id"]] = operator
                trip_counts[operator] += 1

    with (gtfs_dir / "stop_times.txt").open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            operator = trip_to_operator.get(row["trip_id"])
            if operator:
                stop_time_counts[operator] += 1

    return {
        op: {"trips": trip_counts[op], "stop_times": stop_time_counts[op]}
        for op in BUS_OPERATORS
    }


def count_local_db(path: Path) -> dict[str, int]:
    con = sqlite3.connect(path)
    try:
        trips = con.execute("SELECT COUNT(DISTINCT trip_id) FROM stop_times").fetchone()[0]
        stop_times = con.execute("SELECT COUNT(*) FROM stop_times").fetchone()[0]
        return {"trips": trips, "stop_times": stop_times}
    finally:
        con.close()


def refresh_default_gtfs(source_dir: Path) -> None:
    if source_dir.resolve() == DEFAULT_GTFS_DIR.resolve():
        print(f"GTFS directory already current: {DEFAULT_GTFS_DIR}")
        return

    DEFAULT_GTFS_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(path for path in source_dir.iterdir() if path.is_file())
    for source in files:
        target = DEFAULT_GTFS_DIR / source.name
        tmp_target = target.with_suffix(f"{target.suffix}.new")
        shutil.copy2(source, tmp_target)
        tmp_target.replace(target)
    print(f"Refreshed project GTFS files: {DEFAULT_GTFS_DIR} ({len(files)} files)")


def print_route_report(gtfs_dir: Path) -> tuple[bool, bool]:
    static_routes, route_to_operator = read_static_routes(gtfs_dir)
    json_changed = False

    print("Routes:")
    for operator, json_path in ROUTE_JSON.items():
        local = load_local_route_ids(json_path)
        static = static_routes[operator]
        missing = static - local
        extra = local - static
        changed = bool(missing or extra)
        json_changed = json_changed or changed
        status = "CHANGED" if changed else "unchanged"
        print(
            f"  {operator}: {status} "
            f"(static={len(static)}, local={len(local)}, "
            f"missing={len(missing)}, extra={len(extra)})"
        )
        if missing:
            print(f"    missing sample: {', '.join(sorted(missing)[:8])}")
        if extra:
            print(f"    extra sample: {', '.join(sorted(extra)[:8])}")

    print()
    schedule_counts = count_static_schedules(gtfs_dir, route_to_operator)
    db_changed = False
    print("Schedule DB counts:")
    for operator, db_path in DB_FILES.items():
        static = schedule_counts[operator]
        local = count_local_db(db_path)
        changed = static != local
        db_changed = db_changed or changed
        status = "CHANGED" if changed else "unchanged"
        print(
            f"  {operator}: {status} "
            f"(static trips={static['trips']}, db trips={local['trips']}; "
            f"static stop_times={static['stop_times']}, db stop_times={local['stop_times']})"
        )

    print()
    print("Decision:")
    if json_changed:
        print("  JSON changed. Regenerate JSON/shapes/stops, deploy app, then update DBs.")
    elif db_changed:
        print("  JSON unchanged. Regenerate/upload schedule DBs only.")
    else:
        print("  JSON and schedule DB counts are unchanged. No data update needed.")

    return json_changed, db_changed


def main() -> int:
    args = parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        gtfs_dir = resolve_gtfs_dir(args, Path(tmp))
        feed = read_feed_info(gtfs_dir)
        print(f"GTFS source: {gtfs_dir}")
        if feed:
            print(
                "Feed: "
                f"start={feed.get('feed_start_date', '?')} "
                f"end={feed.get('feed_end_date', '?')} "
                f"version={feed.get('feed_version', '?')}"
            )
        print()
        json_changed, db_changed = print_route_report(gtfs_dir)
        if json_changed or db_changed:
            print()
            refresh_default_gtfs(gtfs_dir)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
