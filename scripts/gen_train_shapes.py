#!/usr/bin/env python3
"""
Generate Irish Rail static data files:
  src/data/train-shapes.json            — polylines per route+direction
  src/data/train-routes.json            — route metadata list
  src/data/train-stops.json             — stops used by Irish Rail
  src/data/train-routes-by-endpoints.json — "origin|dest" -> {routeId, directionId}

Uses GTFS static data present at the project's gtfs/ directory.
Irish Rail agency_id: 7778017

Strategy (mirrors gen_bus_shapes.py):
  - For each (route_id, direction_id), pick the trip with the most stops (longest trip).
  - Use that trip's shape_id for the polyline; its headsign for display.
  - Simplify polylines with inline RDP at ~15m tolerance.
  - Stream stop_times.txt once to collect all needed data.
"""

import csv
import json
import math
import os
import sys
from collections import defaultdict

GTFS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "gtfs"))
DATA_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "src", "data"))

OUT_SHAPES = f"{DATA_DIR}/train-shapes.json"
OUT_ROUTES = f"{DATA_DIR}/train-routes.json"
OUT_STOPS = f"{DATA_DIR}/train-stops.json"
OUT_ENDPOINTS = f"{DATA_DIR}/train-routes-by-endpoints.json"

AGENCY_ID = "7778017"

# RDP tolerance in degrees — 15m ≈ 0.000135 deg at Irish latitudes (cos(53°) ~ 0.60)
# We use perpendicular distance in equirectangular space, scaled by cos(lat).
RDP_TOLERANCE_M = 15.0
EARTH_RADIUS_M = 6_371_000.0
LAT_REF = 53.0  # degrees, middle of Ireland
COS_LAT = math.cos(math.radians(LAT_REF))
# 1 degree latitude ≈ EARTH_RADIUS_M * pi/180
DEG_TO_M = EARTH_RADIUS_M * math.pi / 180.0
# 15m in degrees (latitude-equivalent)
RDP_EPS = RDP_TOLERANCE_M / DEG_TO_M


def rdp_perp_dist(p, start, end):
    """Perpendicular distance from point p to line segment (start, end) in equirectangular space."""
    # Scale longitude by cos(lat) to get approximate equal-distance space
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
    # Find the point with max distance from the line start->end
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
    # ── 1. Load Irish Rail routes ──────────────────────────────────────────────
    rail_routes: dict[str, dict] = {}  # route_id -> {short_name, long_name}
    with open(f"{GTFS_DIR}/routes.txt", newline="") as f:
        for row in csv.DictReader(f):
            if row["agency_id"] == AGENCY_ID:
                rail_routes[row["route_id"]] = {
                    "shortName": row["route_short_name"].strip(),
                    "longName": row["route_long_name"].strip(),
                }
    print(f"Irish Rail routes: {len(rail_routes)}", file=sys.stderr)

    # ── 2. Load trips for Irish Rail ───────────────────────────────────────────
    # trip_id -> {route_id, direction_id, shape_id, headsign}
    trip_meta: dict[str, dict] = {}
    # (route_id, direction_id) -> list of trip_ids
    route_dir_trips: dict[tuple, list] = defaultdict(list)

    with open(f"{GTFS_DIR}/trips.txt", newline="") as f:
        for row in csv.DictReader(f):
            rid = row["route_id"]
            if rid not in rail_routes:
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
    print(f"Irish Rail trips: {len(all_trip_ids):,}", file=sys.stderr)

    # ── 3. Stream stop_times.txt once ─────────────────────────────────────────
    # Collect: per trip -> list of (sequence, stop_id)
    trip_stops: dict[str, list] = defaultdict(list)

    line_count = 0
    with open(f"{GTFS_DIR}/stop_times.txt", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            line_count += 1
            if line_count % 2_000_000 == 0:
                print(f"  ...{line_count:,} rows read", file=sys.stderr)
            tid = row["trip_id"]
            if tid not in all_trip_ids:
                continue
            trip_stops[tid].append((int(row["stop_sequence"]), row["stop_id"]))

    print(f"stop_times rows read: {line_count:,}", file=sys.stderr)
    print(f"Trips with stop data: {len(trip_stops)}", file=sys.stderr)

    # Sort each trip's stops by sequence
    for tid in trip_stops:
        trip_stops[tid].sort(key=lambda x: x[0])

    # ── 4. Load all stops ─────────────────────────────────────────────────────
    stops_dict: dict[str, dict] = {}
    with open(f"{GTFS_DIR}/stops.txt", newline="") as f:
        for row in csv.DictReader(f):
            stops_dict[row["stop_id"]] = {
                "name": row["stop_name"].strip(),
                "lat": round(float(row["stop_lat"]), 6),
                "lng": round(float(row["stop_lon"]), 6),
            }
    print(f"Stops loaded: {len(stops_dict):,}", file=sys.stderr)

    # ── 5. Load shapes.txt for Irish Rail shape_ids ────────────────────────────
    # Collect needed shape_ids: those used by the best trip per route+direction
    # First, determine best trip per route+direction (most stops)
    best_trips: dict[tuple, str] = {}
    for key, trips in route_dir_trips.items():
        best = max(trips, key=lambda t: len(trip_stops.get(t, [])))
        best_trips[key] = best

    needed_shape_ids: set[str] = set()
    for tid in best_trips.values():
        needed_shape_ids.add(trip_meta[tid]["shape_id"])
    print(f"Shape IDs needed: {len(needed_shape_ids)}", file=sys.stderr)

    # Load those shapes
    raw_shapes: dict[str, list] = defaultdict(list)
    with open(f"{GTFS_DIR}/shapes.txt", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sid = row["shape_id"]
            if sid not in needed_shape_ids:
                continue
            raw_shapes[sid].append(
                (int(row["shape_pt_sequence"]), float(row["shape_pt_lat"]), float(row["shape_pt_lon"]))
            )

    # Sort and simplify each shape
    simplified_shapes: dict[str, list] = {}
    for sid, pts in raw_shapes.items():
        pts.sort(key=lambda x: x[0])
        coords = [(lat, lon) for _, lat, lon in pts]
        simplified = rdp(coords, RDP_EPS)
        simplified_shapes[sid] = [[round(lat, 6), round(lon, 6)] for lat, lon in simplified]
        print(
            f"  Shape {sid}: {len(coords)} pts -> {len(simplified)} pts after RDP",
            file=sys.stderr,
        )

    # ── 6. Build train-shapes.json ─────────────────────────────────────────────
    train_shapes: dict[str, dict] = {}
    for (rid, dir_id), tid in best_trips.items():
        meta = trip_meta[tid]
        shape_id = meta["shape_id"]
        coords = simplified_shapes.get(shape_id, [])
        if rid not in train_shapes:
            train_shapes[rid] = {}
        # Build stops list for this best trip
        stop_rows = trip_stops.get(tid, [])
        stop_list = []
        for _, sid in stop_rows:
            s = stops_dict.get(sid)
            if s:
                stop_list.append({"id": sid, "name": s["name"], "lat": s["lat"], "lng": s["lng"]})
        train_shapes[rid][dir_id] = {
            "headsign": meta["headsign"],
            "shapeId": shape_id,
            "coords": coords,
            "stops": stop_list,
        }

    with open(OUT_SHAPES, "w") as f:
        json.dump(train_shapes, f, separators=(",", ":"))
    size_kb = os.path.getsize(OUT_SHAPES) / 1024
    print(f"Written: {OUT_SHAPES} ({size_kb:.1f} KB)", file=sys.stderr)

    # ── 7. Build train-routes.json ─────────────────────────────────────────────
    route_list = [
        {"id": rid, "shortName": info["shortName"], "longName": info["longName"]}
        for rid, info in sorted(rail_routes.items())
    ]
    with open(OUT_ROUTES, "w") as f:
        json.dump(route_list, f, indent=2)
    size_kb = os.path.getsize(OUT_ROUTES) / 1024
    print(f"Written: {OUT_ROUTES} ({size_kb:.1f} KB)", file=sys.stderr)

    # ── 8. Build train-stops.json ─────────────────────────────────────────────
    # Collect all stop_ids used by any Irish Rail trip
    used_stop_ids: set[str] = set()
    for tid in all_trip_ids:
        for _, sid in trip_stops.get(tid, []):
            used_stop_ids.add(sid)

    train_stops: dict[str, dict] = {}
    for sid in used_stop_ids:
        s = stops_dict.get(sid)
        if s:
            train_stops[sid] = s

    with open(OUT_STOPS, "w") as f:
        json.dump(train_stops, f, separators=(",", ":"))
    size_kb = os.path.getsize(OUT_STOPS) / 1024
    print(f"Written: {OUT_STOPS} ({size_kb:.1f} KB, {len(train_stops)} stops)", file=sys.stderr)

    # ── 9. Build train-routes-by-endpoints.json ───────────────────────────────
    # For each trip, get first and last stop name, build key "origin|dest"
    endpoints: dict[str, dict] = {}
    for tid, meta in trip_meta.items():
        stops_seq = trip_stops.get(tid, [])
        if len(stops_seq) < 2:
            continue
        first_sid = stops_seq[0][1]
        last_sid = stops_seq[-1][1]
        first_name = stops_dict.get(first_sid, {}).get("name", "")
        last_name = stops_dict.get(last_sid, {}).get("name", "")
        if not first_name or not last_name:
            continue
        key = f"{first_name.lower().strip()}|{last_name.lower().strip()}"
        endpoints[key] = {
            "routeId": meta["route_id"],
            "directionId": int(meta["direction_id"]),
        }

    with open(OUT_ENDPOINTS, "w") as f:
        json.dump(endpoints, f, indent=2)
    size_kb = os.path.getsize(OUT_ENDPOINTS) / 1024
    print(
        f"Written: {OUT_ENDPOINTS} ({size_kb:.1f} KB, {len(endpoints)} endpoint pairs)",
        file=sys.stderr,
    )

    # ── 10. Summary ──────────────────────────────────────────────────────────
    print("\n=== Summary ===", file=sys.stderr)
    print(f"Routes: {len(train_shapes)}", file=sys.stderr)
    print(f"Route+direction shapes: {sum(len(v) for v in train_shapes.values())}", file=sys.stderr)
    print(f"Stops: {len(train_stops)}", file=sys.stderr)
    print(f"Endpoint pairs: {len(endpoints)}", file=sys.stderr)
    print("\nRoutes:", file=sys.stderr)
    for rid, dirs in sorted(train_shapes.items()):
        rinfo = rail_routes[rid]
        for dir_id, data in sorted(dirs.items()):
            n_coords = len(data["coords"])
            n_stops = len(data["stops"])
            print(
                f"  {rid} dir={dir_id}: '{data['headsign']}' — {n_coords} coords, {n_stops} stops",
                file=sys.stderr,
            )


if __name__ == "__main__":
    main()
