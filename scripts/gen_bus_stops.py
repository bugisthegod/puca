#!/usr/bin/env python3
"""
Generate src/data/dublinbus-stops.json: { stop_id: { name, lat, lng } }
for all stops used by Dublin Bus trips (route_id starting with 5570_).
"""
import csv
import json
import os
import sys

GTFS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "gtfs"))
OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "src", "data", "dublinbus-stops.json"))


def main():
    # Step 1: collect trip_ids for 5570_ routes
    trip_ids: set[str] = set()
    with open(f"{GTFS_DIR}/trips.txt", newline="") as f:
        for row in csv.DictReader(f):
            if row["route_id"].startswith("5570_"):
                trip_ids.add(row["trip_id"])
    print(f"Dublin Bus trip_ids: {len(trip_ids):,}", file=sys.stderr)

    # Step 2: stream stop_times.txt, collect stop_ids used by those trips
    used_stop_ids: set[str] = set()
    line_count = 0
    with open(f"{GTFS_DIR}/stop_times.txt", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            line_count += 1
            if line_count % 2_000_000 == 0:
                print(f"  ...{line_count:,} rows read", file=sys.stderr)
            if row["trip_id"] in trip_ids:
                used_stop_ids.add(row["stop_id"])
    print(f"stop_times rows read: {line_count:,}", file=sys.stderr)
    print(f"Unique stop_ids used: {len(used_stop_ids):,}", file=sys.stderr)

    # Step 3: parse stops.txt, filter to used stops
    result: dict[str, dict] = {}
    with open(f"{GTFS_DIR}/stops.txt", newline="") as f:
        for row in csv.DictReader(f):
            sid = row["stop_id"]
            if sid not in used_stop_ids:
                continue
            result[sid] = {
                "name": row["stop_name"],
                "lat": round(float(row["stop_lat"]), 6),
                "lng": round(float(row["stop_lon"]), 6),
                "code": (row.get("stop_code") or "").strip(),
            }
    print(f"Stops written: {len(result):,}", file=sys.stderr)

    with open(OUT, "w") as f:
        json.dump(result, f, separators=(",", ":"))

    size_kb = os.path.getsize(OUT) / 1024
    print(f"Written: {OUT} ({size_kb:.1f} KB)", file=sys.stderr)

    # Sample entries
    sample = list(result.items())[:3]
    for sid, data in sample:
        print(f"  {sid}: {data}", file=sys.stderr)


if __name__ == "__main__":
    main()
