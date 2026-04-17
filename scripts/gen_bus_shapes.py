#!/usr/bin/env python3
"""
Regenerate src/data/dublinbus-shapes.json, adding stops arrays to each direction.
Strategy: for each (route_id, direction_id), pick the trip with the most stops.
"""
import csv
import json
import sys
from collections import defaultdict

GTFS_DIR = "/Users/abel/Downloads/GTFS_Realtime"
SHAPES_JSON = "/Users/abel/Documents/Code/IrishRailTracker/src/data/dublinbus-shapes.json"

def main():
    # Load existing shapes (preserve headsign + coords)
    with open(SHAPES_JSON) as f:
        shapes = json.load(f)

    bus_route_ids = set(shapes.keys())
    print(f"Route count: {len(bus_route_ids)}", file=sys.stderr)

    # Parse trips.txt: collect (route_id, direction_id) -> list of trip_ids
    route_dir_trips: dict[tuple, list] = defaultdict(list)
    with open(f"{GTFS_DIR}/trips.txt", newline="") as f:
        for row in csv.DictReader(f):
            rid = row["route_id"]
            if rid not in bus_route_ids:
                continue
            route_dir_trips[(rid, row["direction_id"])].append(row["trip_id"])

    all_candidate_trips: set[str] = set()
    for trips in route_dir_trips.values():
        all_candidate_trips.update(trips)
    print(f"Candidate trips: {len(all_candidate_trips)}", file=sys.stderr)

    # Parse stops.txt fully
    stops_dict: dict[str, dict] = {}
    with open(f"{GTFS_DIR}/stops.txt", newline="") as f:
        for row in csv.DictReader(f):
            stops_dict[row["stop_id"]] = {
                "name": row["stop_name"],
                "lat": float(row["stop_lat"]),
                "lng": float(row["stop_lon"]),
            }
    print(f"Stops loaded: {len(stops_dict)}", file=sys.stderr)

    # Stream stop_times.txt — collect (trip_id -> list of (seq, stop_id))
    trip_stop_rows: dict[str, list] = defaultdict(list)
    line_count = 0
    with open(f"{GTFS_DIR}/stop_times.txt", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            line_count += 1
            if line_count % 2_000_000 == 0:
                print(f"  ...{line_count:,} rows read", file=sys.stderr)
            tid = row["trip_id"]
            if tid not in all_candidate_trips:
                continue
            trip_stop_rows[tid].append((int(row["stop_sequence"]), row["stop_id"]))
    print(f"stop_times rows read: {line_count:,}", file=sys.stderr)
    print(f"Trips with stop data: {len(trip_stop_rows)}", file=sys.stderr)

    # For each (route_id, direction_id), pick trip with most stops
    best_trips: dict[tuple, str] = {}
    for key, trips in route_dir_trips.items():
        best = max(trips, key=lambda t: len(trip_stop_rows.get(t, [])))
        best_trips[key] = best

    # Build stops arrays and merge into shapes
    for (rid, direction_id), trip_id in best_trips.items():
        if rid not in shapes or direction_id not in shapes[rid]:
            continue
        rows = trip_stop_rows.get(trip_id, [])
        rows.sort(key=lambda x: x[0])
        stop_list = []
        for _, sid in rows:
            s = stops_dict.get(sid)
            if s:
                stop_list.append({"id": sid, "name": s["name"], "lat": s["lat"], "lng": s["lng"]})
        shapes[rid][direction_id]["stops"] = stop_list

    # Fill in empty stops for any direction that was skipped
    for rid, dirs in shapes.items():
        for direction_id, dirdata in dirs.items():
            if "stops" not in dirdata:
                dirdata["stops"] = []

    # Verify route 39A
    route_39a_id = None
    routes = json.load(open("/Users/abel/Documents/Code/IrishRailTracker/src/data/dublinbus-routes.json"))
    for r in routes:
        if r["shortName"] == "39A":
            route_39a_id = r["id"]
            break
    if route_39a_id and route_39a_id in shapes:
        for d in ["0", "1"]:
            if d in shapes[route_39a_id]:
                stops = shapes[route_39a_id][d]["stops"]
                print(f"39A dir {d}: {len(stops)} stops, first={stops[0]['name'] if stops else 'none'}, last={stops[-1]['name'] if stops else 'none'}")

    with open(SHAPES_JSON, "w") as f:
        json.dump(shapes, f, separators=(",", ":"))
    print(f"Written: {SHAPES_JSON}", file=sys.stderr)

if __name__ == "__main__":
    main()
