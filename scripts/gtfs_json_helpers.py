import json
import os
import sys


def write_operator_stops_json(out_path: str, stops_by_id: dict, trip_stops: dict) -> None:
    used_stop_ids = {sid for rows in trip_stops.values() for _, sid in rows}
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
