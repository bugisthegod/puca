#!/usr/bin/env python3
"""
Generate Bus Éireann static data files:
  src/data/buseireann-shapes.json   — polylines per route+direction (with stops)
  src/data/buseireann-routes.json   — route metadata list

Bus Éireann agency_id in this GTFS feed: 7778020
(Route IDs use the 5549_ prefix for 205/206 routes; filter by agency_id to catch all.)

Strategy (mirrors gen_train_shapes.py):
  - For each (route_id, direction_id), pick the trip with the most stops (longest trip).
  - Use that trip's shape_id for the polyline; its headsign for display.
  - Simplify polylines with RDP.
  - Stream stop_times.txt once to collect all needed data.
"""

import csv
import json
import math
import os
import sys
from collections import defaultdict

GTFS_DIR = "/Users/abel/Downloads/GTFS_Realtime"
DATA_DIR = "/Users/abel/Documents/Code/IrishRailTracker/src/data"

OUT_SHAPES = f"{DATA_DIR}/buseireann-shapes.json"
OUT_ROUTES = f"{DATA_DIR}/buseireann-routes.json"

AGENCY_ID = "7778020"

# RDP tolerance: start at 20m (same as Dublin Bus convention).
# Bus Éireann has intercity routes up to ~250 km; if shapes.json > 5 MB,
# we'll note it. The script prints final file size so caller can decide.
RDP_TOLERANCE_M = 20.0
EARTH_RADIUS_M = 6_371_000.0
LAT_REF = 53.0  # middle of Ireland
COS_LAT = math.cos(math.radians(LAT_REF))
DEG_TO_M = EARTH_RADIUS_M * math.pi / 180.0
RDP_EPS = RDP_TOLERANCE_M / DEG_TO_M


def rdp_perp_dist(p, start, end):
    """Perpendicular distance from point p to line segment (start, end)."""
    def to_xy(coord):
        return (coord[1] * COS_LAT, coord[0])  # (x=lon*cos, y=lat)

    px, py = to_xy(p)
    sx, sy = to_xy(start)
    ex, ey = to_xy(end)

    dx, dy = ex - sx, ey - sy
    if dx == 0 and dy == 0:
        return math.hypot(px - sx, py - sy)

    t = ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    proj_x = sx + t * dx
    proj_y = sy + t * dy
    return math.hypot(px - proj_x, py - proj_y)


def rdp(points, epsilon):
    """Ramer-Douglas-Peucker polyline simplification."""
    if len(points) < 3:
        return points
    max_dist = 0.0
    max_idx = 0
    start, end = points[0], points[-1]
    for i in range(1, len(points) - 1):
        d = rdp_perp_dist(points[i], start, end)
        if d > max_dist:
            max_dist = d
            max_idx = i
    if max_dist > epsilon:
        left = rdp(points[: max_idx + 1], epsilon)
        right = rdp(points[max_idx:], epsilon)
        return left[:-1] + right
    else:
        return [start, end]


def main():
    # ── 1. Load Bus Éireann routes ─────────────────────────────────────────────
    be_routes: dict[str, dict] = {}  # route_id -> {shortName, longName}
    with open(f"{GTFS_DIR}/routes.txt", newline="") as f:
        for row in csv.DictReader(f):
            if row["agency_id"] == AGENCY_ID:
                be_routes[row["route_id"]] = {
                    "shortName": row["route_short_name"].strip(),
                    "longName": row["route_long_name"].strip(),
                }
    print(f"Bus Éireann routes: {len(be_routes)}", file=sys.stderr)

    # ── 2. Load trips ──────────────────────────────────────────────────────────
    trip_meta: dict[str, dict] = {}
    route_dir_trips: dict[tuple, list] = defaultdict(list)

    with open(f"{GTFS_DIR}/trips.txt", newline="") as f:
        for row in csv.DictReader(f):
            rid = row["route_id"]
            if rid not in be_routes:
                continue
            tid = row["trip_id"]
            trip_meta[tid] = {
                "route_id": rid,
                "direction_id": row["direction_id"],
                "shape_id": row["shape_id"],
                "headsign": row["trip_headsign"].strip(),
            }
            route_dir_trips[(rid, row["direction_id"])].append(tid)

    all_trip_ids = set(trip_meta.keys())
    print(f"Bus Éireann trips: {len(all_trip_ids):,}", file=sys.stderr)
    print(f"Route+direction combos: {len(route_dir_trips)}", file=sys.stderr)

    # ── 3. Stream stop_times.txt once ─────────────────────────────────────────
    trip_stops: dict[str, list] = defaultdict(list)
    line_count = 0
    with open(f"{GTFS_DIR}/stop_times.txt", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            line_count += 1
            if line_count % 1_000_000 == 0:
                print(f"  ...{line_count:,} stop_times rows read", file=sys.stderr)
            tid = row["trip_id"]
            if tid not in all_trip_ids:
                continue
            trip_stops[tid].append((int(row["stop_sequence"]), row["stop_id"]))

    print(f"stop_times rows read: {line_count:,}", file=sys.stderr)
    print(f"Trips with stop data: {len(trip_stops)}", file=sys.stderr)

    for tid in trip_stops:
        trip_stops[tid].sort(key=lambda x: x[0])

    # ── 4. Load stops ──────────────────────────────────────────────────────────
    stops_dict: dict[str, dict] = {}
    with open(f"{GTFS_DIR}/stops.txt", newline="") as f:
        for row in csv.DictReader(f):
            stops_dict[row["stop_id"]] = {
                "name": row["stop_name"].strip(),
                "lat": round(float(row["stop_lat"]), 6),
                "lng": round(float(row["stop_lon"]), 6),
            }
    print(f"Stops loaded: {len(stops_dict):,}", file=sys.stderr)

    # ── 5. Determine best trip per route+direction ─────────────────────────────
    best_trips: dict[tuple, str] = {}
    for key, trips in route_dir_trips.items():
        best = max(trips, key=lambda t: len(trip_stops.get(t, [])))
        best_trips[key] = best

    needed_shape_ids: set[str] = set()
    for tid in best_trips.values():
        sid = trip_meta[tid]["shape_id"]
        if sid:
            needed_shape_ids.add(sid)
    print(f"Shape IDs needed: {len(needed_shape_ids)}", file=sys.stderr)

    # ── 6. Load and simplify needed shapes ────────────────────────────────────
    raw_shapes: dict[str, list] = defaultdict(list)
    with open(f"{GTFS_DIR}/shapes.txt", newline="") as f:
        for row in csv.DictReader(f):
            sid = row["shape_id"]
            if sid not in needed_shape_ids:
                continue
            raw_shapes[sid].append(
                (int(row["shape_pt_sequence"]), float(row["shape_pt_lat"]), float(row["shape_pt_lon"]))
            )
    print(f"Raw shapes loaded: {len(raw_shapes)}", file=sys.stderr)

    simplified_shapes: dict[str, list] = {}
    total_raw = 0
    total_simplified = 0
    for sid, pts in raw_shapes.items():
        pts.sort(key=lambda x: x[0])
        coords = [(lat, lon) for _, lat, lon in pts]
        simplified = rdp(coords, RDP_EPS)
        simplified_shapes[sid] = [[round(lat, 6), round(lon, 6)] for lat, lon in simplified]
        total_raw += len(coords)
        total_simplified += len(simplified)
    print(f"Shape point reduction: {total_raw:,} → {total_simplified:,} pts ({RDP_TOLERANCE_M}m RDP)", file=sys.stderr)

    # ── 7. Build buseireann-shapes.json ───────────────────────────────────────
    be_shapes: dict[str, dict] = {}
    for (rid, dir_id), tid in best_trips.items():
        meta = trip_meta[tid]
        shape_id = meta["shape_id"]
        coords = simplified_shapes.get(shape_id, [])
        if rid not in be_shapes:
            be_shapes[rid] = {}
        stop_rows = trip_stops.get(tid, [])
        stop_list = []
        for _, sid in stop_rows:
            s = stops_dict.get(sid)
            if s:
                stop_list.append({"id": sid, "name": s["name"], "lat": s["lat"], "lng": s["lng"]})
        be_shapes[rid][dir_id] = {
            "headsign": meta["headsign"],
            "coords": coords,
            "stops": stop_list,
        }

    with open(OUT_SHAPES, "w") as f:
        json.dump(be_shapes, f, separators=(",", ":"))
    size_kb = os.path.getsize(OUT_SHAPES) / 1024
    size_mb = size_kb / 1024
    print(f"Written: {OUT_SHAPES} ({size_mb:.2f} MB)", file=sys.stderr)
    if size_mb > 5.0:
        print(f"  WARNING: buseireann-shapes.json is {size_mb:.2f} MB (> 5 MB target).", file=sys.stderr)
        print(f"  Consider re-running with RDP_TOLERANCE_M=30 or 50.", file=sys.stderr)

    # ── 8. Build buseireann-routes.json ───────────────────────────────────────
    route_list = [
        {"id": rid, "shortName": info["shortName"], "longName": info["longName"]}
        for rid, info in sorted(be_routes.items())
    ]
    with open(OUT_ROUTES, "w") as f:
        json.dump(route_list, f, indent=2)
    size_kb2 = os.path.getsize(OUT_ROUTES) / 1024
    print(f"Written: {OUT_ROUTES} ({size_kb2:.1f} KB, {len(route_list)} routes)", file=sys.stderr)

    # ── 9. Summary ────────────────────────────────────────────────────────────
    print("\n=== Summary ===", file=sys.stderr)
    print(f"Routes: {len(be_shapes)}", file=sys.stderr)
    print(f"Route+direction shapes: {sum(len(v) for v in be_shapes.values())}", file=sys.stderr)
    missing_shapes = sum(1 for v in be_shapes.values() for d in v.values() if not d["coords"])
    if missing_shapes:
        print(f"WARNING: {missing_shapes} route+directions have no shape coords", file=sys.stderr)
    no_stops = sum(1 for v in be_shapes.values() for d in v.values() if not d["stops"])
    if no_stops:
        print(f"WARNING: {no_stops} route+directions have no stops", file=sys.stderr)


if __name__ == "__main__":
    main()
