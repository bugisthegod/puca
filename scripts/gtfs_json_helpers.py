import csv
import json
import os
import sys


def select_best_trip_stops(
    stop_times_path: str,
    trip_meta: dict,
    candidate_trip_ids: set[str],
    trip_ranks: dict[str, int],
    *,
    collect_endpoints: bool = False,
    progress_every: int = 2_000_000,
) -> tuple[dict, dict, set[str], dict, int, int]:
    """Select the longest candidate trips without retaining every stop row.

    NTA stop times are grouped by trip_id. Only one trip and the current best
    trip for each route+direction remain in memory. ``trip_ranks`` preserves
    the old first-trip-wins behavior when stop counts tie.
    """
    best_trips: dict[tuple, str] = {}
    best_scores: dict[tuple, tuple[int, int]] = {}
    best_trip_stops: dict[str, list] = {}
    used_stop_ids: set[str] = set()
    endpoints: dict[str, tuple[str, str]] = {}
    completed_trip_ids: set[str] = set()
    line_count = 0
    trips_with_data = 0
    current_tid: str | None = None
    current_rows: list[tuple[int, str]] = []

    def finish_trip() -> None:
        nonlocal trips_with_data
        if current_tid is None or current_tid not in trip_meta:
            return

        trips_with_data += 1
        ordered_rows = sorted(current_rows, key=lambda item: item[0])
        if collect_endpoints and len(ordered_rows) >= 2:
            endpoints[current_tid] = (ordered_rows[0][1], ordered_rows[-1][1])

        if current_tid not in candidate_trip_ids:
            return

        meta = trip_meta[current_tid]
        key = (meta["route_id"], meta["direction_id"])
        score = (len(ordered_rows), -trip_ranks[current_tid])
        if score <= best_scores.get(key, (-1, -sys.maxsize)):
            return

        previous_tid = best_trips.get(key)
        if previous_tid is not None:
            best_trip_stops.pop(previous_tid, None)
        best_scores[key] = score
        best_trips[key] = current_tid
        best_trip_stops[current_tid] = ordered_rows

    with open(stop_times_path, newline="") as f:
        for row in csv.DictReader(f):
            line_count += 1
            if line_count % progress_every == 0:
                print(f"  ...{line_count:,} stop_times rows read", file=sys.stderr)

            tid = row["trip_id"]
            if tid != current_tid:
                finish_trip()
                if tid in completed_trip_ids:
                    raise ValueError(
                        "stop_times.txt is not grouped by trip_id; "
                        f"trip {tid!r} appears in multiple sections"
                    )
                if current_tid is not None and current_tid in trip_meta:
                    completed_trip_ids.add(current_tid)
                current_tid = tid
                current_rows = []

            if tid not in trip_meta:
                continue
            stop_id = row["stop_id"]
            used_stop_ids.add(stop_id)
            current_rows.append((int(row["stop_sequence"]), stop_id))

    finish_trip()
    return best_trips, best_trip_stops, used_stop_ids, endpoints, line_count, trips_with_data


def write_operator_stops_json(out_path: str, stops_by_id: dict, used_stop_ids: set[str]) -> None:
    stops_out = {
        sid: {
            "name": stop["raw_name"],
            "lat": stop["lat"],
            "lng": stop["lng"],
            "code": stop["code"],
        }
        for sid, stop in stops_by_id.items()
        if sid in used_stop_ids
    }

    with open(out_path, "w") as f:
        json.dump(stops_out, f, separators=(",", ":"))

    size_kb = os.path.getsize(out_path) / 1024
    print(f"Written: {out_path} ({size_kb:.1f} KB, {len(stops_out)} stops)", file=sys.stderr)
