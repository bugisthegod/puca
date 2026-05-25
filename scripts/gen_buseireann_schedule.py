#!/usr/bin/env python3
"""
Generate src/data/buseireann-schedule.db — SQLite schedule for Bus Éireann.

Schema (identical to bus-schedule.db):
  stop_times(trip_id TEXT, stop_sequence INTEGER, stop_id TEXT, arrival_sec INTEGER,
             PRIMARY KEY (trip_id, stop_sequence))

Bus Éireann agency_ids in this GTFS feed:
  2 — "Bus Éireann" (main network)
  WFRD — "Bus Éireann Waterford" (Waterford city W1–W5)
If NTA adds a new Bus Éireann sub-agency, add its id to AGENCY_IDS.
"""
import csv
import os
import sqlite3
import sys

GTFS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "gtfs"))
TRIPS_FILE = f"{GTFS_DIR}/trips.txt"
STOP_TIMES_FILE = f"{GTFS_DIR}/stop_times.txt"
OUT_DB = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "../src/data/buseireann-schedule.db")
)

AGENCY_IDS = {"2", "WFRD"}  # main + Waterford
BATCH_SIZE = 50_000


def parse_arrival_sec(t: str) -> int:
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def main():
    print("Reading routes.txt …")
    be_route_ids: set[str] = set()
    with open(f"{GTFS_DIR}/routes.txt", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["agency_id"] in AGENCY_IDS:
                be_route_ids.add(row["route_id"])
    print(f"  Bus Éireann route_ids: {len(be_route_ids):,}")

    print("Reading trips.txt …")
    be_trips: set[str] = set()
    with open(TRIPS_FILE, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["route_id"] in be_route_ids:
                be_trips.add(row["trip_id"])
    print(f"  Bus Éireann trip_ids: {len(be_trips):,}")

    if os.path.exists(OUT_DB):
        os.remove(OUT_DB)

    con = sqlite3.connect(OUT_DB)
    cur = con.cursor()

    cur.executescript("""
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;
    """)

    cur.execute("""
        CREATE TABLE stop_times (
            trip_id TEXT NOT NULL,
            stop_sequence INTEGER NOT NULL,
            stop_id TEXT NOT NULL,
            arrival_sec INTEGER NOT NULL,
            PRIMARY KEY (trip_id, stop_sequence)
        )
    """)

    print("Streaming stop_times.txt …")
    batch: list[tuple] = []
    total = 0
    skipped = 0

    con.execute("BEGIN")
    with open(STOP_TIMES_FILE, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["trip_id"] not in be_trips:
                continue
            try:
                arrival_sec = parse_arrival_sec(row["arrival_time"])
            except Exception:
                skipped += 1
                continue
            batch.append((
                row["trip_id"],
                int(row["stop_sequence"]),
                row["stop_id"],
                arrival_sec,
            ))
            if len(batch) >= BATCH_SIZE:
                cur.executemany(
                    "INSERT OR IGNORE INTO stop_times VALUES (?,?,?,?)", batch
                )
                total += len(batch)
                batch = []
                print(f"  inserted {total:,} rows …", end="\r", flush=True)

    if batch:
        cur.executemany(
            "INSERT OR IGNORE INTO stop_times VALUES (?,?,?,?)", batch
        )
        total += len(batch)

    con.commit()
    print(f"\n  total inserted: {total:,}")
    if skipped:
        print(f"  skipped (bad arrival_time): {skipped:,}")

    print("Creating index …")
    cur.execute("CREATE INDEX idx_stop_times_trip ON stop_times(trip_id)")
    cur.execute("CREATE INDEX idx_stop_times_stop ON stop_times(stop_id)")
    con.commit()

    print("Running VACUUM …")
    con.execute("VACUUM")
    con.close()

    size_mb = os.path.getsize(OUT_DB) / 1024 / 1024
    print(f"Done. DB: {OUT_DB}")
    print(f"  Size: {size_mb:.1f} MB")
    print(f"  Rows: {total:,}")
    if size_mb > 300:
        print(f"  NOTE: DB is {size_mb:.0f} MB — factor into Fly.io 1 GB volume budget.")


if __name__ == "__main__":
    main()
