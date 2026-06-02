#!/usr/bin/env python3
"""
Generate Dublin Bus static data files:
  src/data/dublinbus-shapes.json   — polylines per route+direction (with stops)
  src/data/dublinbus-routes.json   — route metadata list
  src/data/dublinbus-stops.json    — all stops used by Dublin Bus trips

Dublin Bus agency_id in this GTFS feed: 1

Strategy:
  - For each (route_id, direction_id), pick the MODAL shape_id — the shape
    used by the most trips. Among trips using that shape, pick the one with
    the most stops for the stop list + headsign. That trip's shape_id becomes
    main; its stops are drawn on the overview.
  - The top-N OTHER shape_ids (excluding main) are emitted as variants with
    their "off-main" branch segments.
  - Simplify polylines with RDP.
  - Stream stop_times.txt once to collect all needed data.

Why modal, not longest: "longest" trip is sometimes an outlier (e.g. route 38
has a 12-trip shape that skips a small residential detour most 38s take,
scoring 58 stops vs 53 because it reaches further at the terminus). Using it
as main inverts branch detection — every common variant lights up the same
"branch" where main is actually the odd one out. Modal ("what most buses
do") makes main represent the typical path; genuine minority patterns become
variants with meaningful distinguishing branches.

Why coords and stops come from the SAME trip: if they disagree — e.g. coords
from one shape, stops from a trip on a different shape — stops float off the
polyline. This was a bug that caused 17/65 stops on route 38 to appear off-line.
"""

import csv
import json
import math
import os
import sys
from collections import defaultdict
from gtfs_json_helpers import write_operator_stops_json

GTFS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "gtfs"))
DATA_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "src", "data"))

OUT_SHAPES = f"{DATA_DIR}/dublinbus-shapes.json"
OUT_ROUTES = f"{DATA_DIR}/dublinbus-routes.json"
OUT_VARIANTS = f"{DATA_DIR}/dublinbus-variants.json"
OUT_STOPS = f"{DATA_DIR}/dublinbus-stops.json"

AGENCY_IDS = {"1"}

RDP_TOLERANCE_M = 20.0
EARTH_RADIUS_M = 6_371_000.0
LAT_REF = 53.0  # middle of Ireland
COS_LAT = math.cos(math.radians(LAT_REF))
DEG_TO_M = EARTH_RADIUS_M * math.pi / 180.0
RDP_EPS = RDP_TOLERANCE_M / DEG_TO_M

# Variant branch detection: keep distance check on RAW variant coords (pre-RDP)
# vs the RDP-simplified main line. 20m RDP on main can offset points by up to
# ~20m from the true street center, so threshold must leave headroom or real
# same-street variant points would false-positive as off-main.
TOP_N_VARIANTS = 5
OFF_MAIN_THRESHOLD_M = 50.0
MIN_BRANCH_M = 100.0
BBOX_PAD_DEG = OFF_MAIN_THRESHOLD_M / DEG_TO_M  # lat pad; lng uses COS_LAT


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
    """Ramer-Douglas-Peucker polyline simplification (iterative to avoid recursion limit)."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2:
            continue
        max_dist = 0.0
        max_idx = lo
        start, end = points[lo], points[hi]
        for i in range(lo + 1, hi):
            d = rdp_perp_dist(points[i], start, end)
            if d > max_dist:
                max_dist = d
                max_idx = i
        if max_dist > epsilon:
            keep[max_idx] = True
            stack.append((lo, max_idx))
            stack.append((max_idx, hi))
    return [p for p, k in zip(points, keep) if k]


def point_to_polyline_dist_m(p, polyline):
    """Min distance from point p to any segment of polyline, in meters.

    Uses a per-segment bbox prefilter (in degree-space) to skip segments that
    cannot possibly be within OFF_MAIN_THRESHOLD_M of p.
    """
    lng_pad = BBOX_PAD_DEG / COS_LAT
    p_lat, p_lng = p
    min_d_deg = float("inf")
    for i in range(len(polyline) - 1):
        s_lat, s_lng = polyline[i]
        e_lat, e_lng = polyline[i + 1]
        lat_min = (s_lat if s_lat < e_lat else e_lat) - BBOX_PAD_DEG
        lat_max = (s_lat if s_lat > e_lat else e_lat) + BBOX_PAD_DEG
        if p_lat < lat_min or p_lat > lat_max:
            continue
        lng_min = (s_lng if s_lng < e_lng else e_lng) - lng_pad
        lng_max = (s_lng if s_lng > e_lng else e_lng) + lng_pad
        if p_lng < lng_min or p_lng > lng_max:
            continue
        d = rdp_perp_dist(p, (s_lat, s_lng), (e_lat, e_lng))
        if d < min_d_deg:
            min_d_deg = d
    return min_d_deg * DEG_TO_M


def polyline_length_m(coords):
    total = 0.0
    for i in range(len(coords) - 1):
        lat1, lng1 = coords[i]
        lat2, lng2 = coords[i + 1]
        dlat = lat2 - lat1
        dlng = (lng2 - lng1) * COS_LAT
        total += math.hypot(dlat, dlng)
    return total * DEG_TO_M


def compute_branches(variant_raw, main_simplified):
    """Return list of simplified branch polylines where variant diverges from main.

    Case 1 only: contiguous runs of variant points off-main, extended by one
    on-main connector point on each side so the branch visually joins main.
    """
    if len(variant_raw) < 2 or len(main_simplified) < 2:
        return []
    offs = [point_to_polyline_dist_m(p, main_simplified) > OFF_MAIN_THRESHOLD_M for p in variant_raw]
    branches = []
    n = len(variant_raw)
    i = 0
    while i < n:
        if not offs[i]:
            i += 1
            continue
        run_start = i
        while i < n and offs[i]:
            i += 1
        run_end = i  # first index NOT off-main (or n)
        start = run_start - 1 if run_start > 0 else run_start
        end = run_end if run_end < n else run_end - 1
        seg = variant_raw[start:end + 1]
        if polyline_length_m(seg) >= MIN_BRANCH_M:
            simplified = rdp(seg, RDP_EPS)
            branches.append([[round(lat, 6), round(lon, 6)] for lat, lon in simplified])
    return branches


def main():
    # ── 1. Load Dublin Bus routes ─────────────────────────────────────────────
    db_routes: dict[str, dict] = {}  # route_id -> {shortName, longName}
    with open(f"{GTFS_DIR}/routes.txt", newline="") as f:
        for row in csv.DictReader(f):
            if row["agency_id"] in AGENCY_IDS:
                db_routes[row["route_id"]] = {
                    "shortName": row["route_short_name"].strip(),
                    "longName": row["route_long_name"].strip(),
                }
    print(f"Dublin Bus routes: {len(db_routes)}", file=sys.stderr)

    # ── 2. Load trips ──────────────────────────────────────────────────────────
    trip_meta: dict[str, dict] = {}
    route_dir_trips: dict[tuple, list] = defaultdict(list)

    with open(f"{GTFS_DIR}/trips.txt", newline="") as f:
        for row in csv.DictReader(f):
            rid = row["route_id"]
            if rid not in db_routes:
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
    print(f"Dublin Bus trips: {len(all_trip_ids):,}", file=sys.stderr)
    print(f"Route+direction combos: {len(route_dir_trips)}", file=sys.stderr)

    # ── 3. Stream stop_times.txt once ─────────────────────────────────────────
    trip_stops: dict[str, list] = defaultdict(list)
    line_count = 0
    with open(f"{GTFS_DIR}/stop_times.txt", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            line_count += 1
            if line_count % 2_000_000 == 0:
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
                "raw_name": row["stop_name"],
                "lat": round(float(row["stop_lat"]), 6),
                "lng": round(float(row["stop_lon"]), 6),
                "code": (row.get("stop_code") or "").strip(),
            }
    print(f"Stops loaded: {len(stops_dict):,}", file=sys.stderr)

    # ── 5. Pick main shape per route+direction ─────────────────────────────────
    # Main = MODAL shape_id (used by the most trips). Among trips using that
    # shape, pick the one with the most stops — that trip's stop list and
    # headsign represent the route. "Coords and stops from the same trip" is
    # the invariant that keeps stops on the polyline (prior bug: stops from
    # longest trip + coords from pre-existing shape → stops floated off line).
    shape_trip_counts: dict[tuple, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for tid, meta in trip_meta.items():
        key = (meta["route_id"], meta["direction_id"])
        sid = meta["shape_id"]
        if sid:
            shape_trip_counts[key][sid] += 1

    best_trips: dict[tuple, str] = {}
    for key, trips in route_dir_trips.items():
        counts = shape_trip_counts.get(key, {})
        if counts:
            # Tie-break by sid lexicographic for deterministic builds.
            modal_sid = max(counts.items(), key=lambda x: (x[1], x[0]))[0]
            modal_trips = [t for t in trips if trip_meta[t].get("shape_id") == modal_sid]
            best = max(modal_trips, key=lambda t: len(trip_stops.get(t, [])))
        else:
            best = max(trips, key=lambda t: len(trip_stops.get(t, [])))
        best_trips[key] = best

    needed_shape_ids: set[str] = set()
    for tid in best_trips.values():
        sid = trip_meta[tid]["shape_id"]
        if sid:
            needed_shape_ids.add(sid)
    print(f"Shape IDs needed (main = modal): {len(needed_shape_ids)}", file=sys.stderr)

    # ── 5b. Collect candidate shape_ids for variants ──────────────────────────
    # Load ALL non-main shapes first. Top-N selection is deferred to after
    # branch computation (step 7b): a rare shape with a real detour should
    # beat a frequent shape that's near-identical to main.
    for key, main_tid in best_trips.items():
        main_sid = trip_meta[main_tid]["shape_id"]
        for sid in shape_trip_counts[key].keys():
            if sid != main_sid:
                needed_shape_ids.add(sid)
    print(f"Shape IDs needed (incl. variant candidates): {len(needed_shape_ids)}", file=sys.stderr)

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

    # ── 7. Build dublinbus-shapes.json ────────────────────────────────────────
    db_shapes: dict[str, dict] = {}
    for (rid, dir_id), tid in best_trips.items():
        meta = trip_meta[tid]
        shape_id = meta["shape_id"]
        coords = simplified_shapes.get(shape_id, [])
        if rid not in db_shapes:
            db_shapes[rid] = {}
        stop_rows = trip_stops.get(tid, [])
        stop_list = []
        for _, sid in stop_rows:
            s = stops_dict.get(sid)
            if s:
                stop_list.append({"id": sid, "name": s["raw_name"].strip(), "lat": s["lat"], "lng": s["lng"]})
        db_shapes[rid][dir_id] = {
            "headsign": meta["headsign"],
            "coords": coords,
            "stops": stop_list,
        }

    with open(OUT_SHAPES, "w") as f:
        json.dump(db_shapes, f, separators=(",", ":"))
    size_kb = os.path.getsize(OUT_SHAPES) / 1024
    size_mb = size_kb / 1024
    print(f"Written: {OUT_SHAPES} ({size_mb:.2f} MB)", file=sys.stderr)
    if size_mb > 5.0:
        print(f"  WARNING: dublinbus-shapes.json is {size_mb:.2f} MB (> 5 MB target).", file=sys.stderr)
        print(f"  Consider re-running with RDP_TOLERANCE_M=30 or 50.", file=sys.stderr)

    # ── 7b. Build dublinbus-variants.json ─────────────────────────────────────
    # For each (route, direction), compute Case 1 branches (contiguous runs
    # where variant's raw coords diverge from main's simplified polyline) for
    # EVERY non-main shape. Keep only shapes that yielded at least one branch;
    # rank those by trip count; take top TOP_N_VARIANTS.
    #
    # Why branches-first then rank: on route 38, the top 5 shapes by trip count
    # are near-identical to main and produce zero branches. The visually
    # distinct variant (5570_203, an industrial-loop pattern) has only 12 trips
    # and would be dropped if we ranked first. Branches-first surfaces it.
    raw_coords_by_sid: dict[str, list] = {}
    for sid, pts in raw_shapes.items():
        pts_sorted = sorted(pts, key=lambda x: x[0])
        raw_coords_by_sid[sid] = [(lat, lon) for _, lat, lon in pts_sorted]

    variants_out: dict[str, dict[str, list]] = {}
    total_variants = 0
    total_branches = 0
    for key, main_tid in best_trips.items():
        rid, dir_id = key
        main_sid = trip_meta[main_tid]["shape_id"]
        main_simplified = simplified_shapes.get(main_sid, [])
        if len(main_simplified) < 2:
            continue
        candidates = [(sid, cnt) for sid, cnt in shape_trip_counts[key].items() if sid != main_sid]
        with_branches: list[tuple[str, int, list]] = []
        for v_sid, v_count in candidates:
            v_raw = raw_coords_by_sid.get(v_sid, [])
            branches = compute_branches(v_raw, main_simplified)
            if branches:
                with_branches.append((v_sid, v_count, branches))
        with_branches.sort(key=lambda x: (-x[1], x[0]))
        top = with_branches[:TOP_N_VARIANTS]
        if top:
            variant_list = [
                {"shapeId": sid, "tripCount": cnt, "branches": br}
                for sid, cnt, br in top
            ]
            if rid not in variants_out:
                variants_out[rid] = {}
            variants_out[rid][dir_id] = variant_list
            total_variants += len(variant_list)
            total_branches += sum(len(v["branches"]) for v in variant_list)

    with open(OUT_VARIANTS, "w") as f:
        json.dump(variants_out, f, separators=(",", ":"))
    size_kb_v = os.path.getsize(OUT_VARIANTS) / 1024
    size_mb_v = size_kb_v / 1024
    print(
        f"Written: {OUT_VARIANTS} ({size_mb_v:.2f} MB, {total_variants} variants, {total_branches} branches)",
        file=sys.stderr,
    )

    # ── 8. Build dublinbus-routes.json ────────────────────────────────────────
    route_list = [
        {"id": rid, "shortName": info["shortName"], "longName": info["longName"]}
        for rid, info in sorted(db_routes.items())
    ]
    with open(OUT_ROUTES, "w") as f:
        json.dump(route_list, f, indent=2)
    size_kb2 = os.path.getsize(OUT_ROUTES) / 1024
    print(f"Written: {OUT_ROUTES} ({size_kb2:.1f} KB, {len(route_list)} routes)", file=sys.stderr)

    # ── 9. Build dublinbus-stops.json ─────────────────────────────────────────
    write_operator_stops_json(OUT_STOPS, stops_dict, trip_stops)

    # ── 10. Summary ───────────────────────────────────────────────────────────
    print("\n=== Summary ===", file=sys.stderr)
    print(f"Routes: {len(db_shapes)}", file=sys.stderr)
    print(f"Route+direction shapes: {sum(len(v) for v in db_shapes.values())}", file=sys.stderr)
    missing_shapes = sum(1 for v in db_shapes.values() for d in v.values() if not d["coords"])
    if missing_shapes:
        print(f"WARNING: {missing_shapes} route+directions have no shape coords", file=sys.stderr)
    no_stops = sum(1 for v in db_shapes.values() for d in v.values() if not d["stops"])
    if no_stops:
        print(f"WARNING: {no_stops} route+directions have no stops", file=sys.stderr)

    # Route 38 sanity check: previously had 17/65 stops off-shape (Ballycoolin loop, etc.)
    for rid, info in db_routes.items():
        if info["shortName"] == "38":
            for d, dd in db_shapes.get(rid, {}).items():
                print(f"38 dir {d} ({dd['headsign']}): {len(dd['coords'])} coord pts, {len(dd['stops'])} stops", file=sys.stderr)
            for d, vlist in variants_out.get(rid, {}).items():
                for v in vlist:
                    print(
                        f"38 dir {d} variant {v['shapeId']}: {v['tripCount']} trips, {len(v['branches'])} branches",
                        file=sys.stderr,
                    )
            break


if __name__ == "__main__":
    main()
