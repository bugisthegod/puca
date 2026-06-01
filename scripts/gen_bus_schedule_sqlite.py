#!/usr/bin/env python3
import csv
import os
import sqlite3
import sys

GTFS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "gtfs"))
ROUTES_FILE = f"{GTFS_DIR}/routes.txt"
TRIPS_FILE = f"{GTFS_DIR}/trips.txt"
STOP_TIMES_FILE = f"{GTFS_DIR}/stop_times.txt"
OUT_DB = os.path.join(os.path.dirname(__file__), "../src/data/bus-schedule.db")
BATCH_SIZE = 50_000

AGENCY_IDS = {"1"}


def parse_arrival_sec(t: str) -> int:
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def main():
    out_path = os.path.normpath(OUT_DB)

    print("Reading routes.txt …")
    dublin_bus_route_ids: set[str] = set()
    with open(ROUTES_FILE, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["agency_id"] in AGENCY_IDS:
                dublin_bus_route_ids.add(row["route_id"])
    print(f"  Dublin Bus routes: {len(dublin_bus_route_ids):,}")

    print("Reading trips.txt …")
    dublin_bus_trips: dict[str, str] = {}  # trip_id -> shape_id
    with open(TRIPS_FILE, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["route_id"] in dublin_bus_route_ids:
                dublin_bus_trips[row["trip_id"]] = row["shape_id"]
    print(f"  Dublin Bus trip_ids: {len(dublin_bus_trips):,}")

    if os.path.exists(out_path):
        os.remove(out_path)

    con = sqlite3.connect(out_path)
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

    cur.execute("""
        CREATE TABLE trips (
            trip_id TEXT PRIMARY KEY,
            shape_id TEXT NOT NULL
        )
    """)
    cur.executemany(
        "INSERT INTO trips (trip_id, shape_id) VALUES (?, ?)",
        ((tid, sid) for tid, sid in dublin_bus_trips.items()),
    )
    con.commit()
    print(f"  trips table: {len(dublin_bus_trips):,} rows")

    print("Streaming stop_times.txt …")
    batch: list[tuple] = []
    total = 0

    con.execute("BEGIN")
    with open(STOP_TIMES_FILE, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["trip_id"] not in dublin_bus_trips:
                continue
            try:
                arrival_sec = parse_arrival_sec(row["arrival_time"])
            except Exception:
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

    print("Creating index …")
    cur.execute("CREATE INDEX idx_stop_times_stop ON stop_times(stop_id)")
    con.commit()

    print("Running VACUUM …")
    con.execute("VACUUM")
    con.close()

    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f"Done. DB: {out_path}")
    print(f"  Size: {size_mb:.1f} MB")
    print(f"  Rows: {total:,}")


if __name__ == "__main__":
    main()
