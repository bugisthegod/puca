#!/usr/bin/env python3
"""Refuse to generate/upload schedules from a different feed than the app JSON."""

import csv
import json
import re
from pathlib import Path


def read_feed(path: Path) -> dict[str, str]:
    with path.open(newline="", encoding="utf-8-sig") as source:
        row = next(csv.DictReader(source))
    if not row.get("feed_version", "").strip():
        raise ValueError(f"Missing feed_version: {path}")
    fields = {key: value.strip() for key, value in row.items()}
    if not re.fullmatch(r"[A-Za-z0-9-]+", fields["feed_version"]):
        raise ValueError(f"Invalid feed_version: {path}")
    return fields


def verify_feed(root: Path) -> None:
    gtfs = root / "gtfs"
    required = ("routes.txt", "trips.txt", "stop_times.txt", "shapes.txt", "stops.txt", "feed_info.txt")
    missing = [name for name in required if not (gtfs / name).is_file()]
    if missing:
        raise ValueError(f"Missing GTFS files: {', '.join(missing)}")

    expected = read_feed(root / ".github/data/feed_info.txt")["feed_version"]
    actual = read_feed(gtfs / "feed_info.txt")["feed_version"]
    if actual != expected:
        raise ValueError(f"GTFS version {actual} does not match app version {expected}; prepare a data update PR first")

    with (gtfs / "routes.txt").open(newline="", encoding="utf-8-sig") as source:
        routes = list(csv.DictReader(source))
    for operator, agencies in (
        ("dublinbus", {"1"}),
        ("buseireann", {"2", "WFRD"}),
        ("goahead", {"3", "03C"}),
    ):
        app_routes = json.loads((root / f"src/data/{operator}-routes.json").read_text())
        app_ids = {route["id"] for route in app_routes}
        feed_ids = {route["route_id"] for route in routes if route["agency_id"] in agencies}
        if not app_ids or app_ids != feed_ids:
            raise ValueError(f"{operator}: app route IDs do not match GTFS route IDs")
    print(f"GTFS {actual}: version and all operator route IDs match app JSON")


if __name__ == "__main__":
    verify_feed(Path(__file__).resolve().parent.parent)
