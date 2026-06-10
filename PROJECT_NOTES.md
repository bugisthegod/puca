# Puca Project Notes

This file keeps durable project context for future maintenance work. It is
intended to be safe for a public repository.

## Product Shape

- Puca is a real-time public transport tracking app for Ireland, centered on
  live vehicle positions on a map.
- It is vehicle-centric, not stop-centric. Arrival/countdown features may exist,
  but the core value is seeing where the bus or train is right now.
- The main user context is being physically at a stop, platform, or nearby
  street corner and wanting to know what is actually moving.
- Puca currently supports bus and Irish Rail/DART. Luas is not supported yet.
- Do not add schedule-only operators that lack realtime vehicle/trip data unless
  the UI clearly communicates that they are not GPS-tracked.

## Product Goals

- Puca is a personal open-source project, not a transport marketplace or growth
  product.
- Prefer privacy-preserving local state and simple operational choices.
- Treat traffic/load issues as code or data problems first. Avoid adding
  infrastructure complexity unless there is a clear user-visible need.

## Development Preferences

- Default to Bun commands and Bun APIs as described in `AGENTS.md`.
- Prefer simple event-driven fixes over continuous real-time recomputation when
  behavior can be captured by direct events like focus, blur, open, or close.
- For responsive UI space issues, adjust layout, font size, padding, and gaps
  before hiding, clipping, truncating, or adding scroll.
- Do not add continuous reactive loops when an event-driven state update will do.
- Do not move search state to `localStorage`.
- Do not move favorites to `sessionStorage`.

## Local Testing Hygiene

- Before committing code changes, run `bun run typecheck`, `bun run lint`, and
  `bun test`.
- If starting a dev server on port 3000, first check whether something is already
  listening.
- If starting a server for testing, track and stop that specific process before
  finishing so port 3000 is free.
- Remove scratch files created during investigation, especially temporary
  downloads, partial archives, curl dumps, or ad-hoc generated files.

## Production And Fly.io

- Production/shared-infra changes require explicit owner authorization.
- Do not run `fly deploy`, `fly scale`, `git push`, DB volume mutations,
  rollback, or other shared production changes unless explicitly requested.
- Schedule SQLite databases are generated locally or in CI, excluded from Docker
  deploys, and stored on the Fly volume.
- For Fly schedule DB uploads, follow the documented flow in
  `docs/fly-schedule-db-update.md`.

## Data And GTFS Notes

- NTA GTFS/GTFS-R route IDs can drift. Diagnose before regenerating data.
- Known NTA drift modes:
  - Static and realtime roll route prefixes together.
  - Static `route_id` schema changes while `trip_id` and `shape_id` remain
    stable.
  - Realtime moves ahead of static temporarily, causing `route_id` mismatches
    even when `trip_id` still matches.
  - Lightweight `feed_info.txt` can lag behind or move ahead of the full zip.
- When bus data unexpectedly drops to zero, compare tracked
  `.github/data/feed_info.txt` with `feed_info.txt` from the full GTFS zip before
  recommending regeneration.
- If lightweight `feed_info.txt` disagrees with the zip, trust the zip for
  regeneration decisions.
- Historical notes live in `docs/nta-feed-history.md`.

## Luas Future Work

- Luas agency prefix observed in NTA data: `5242`.
- Luas appears in TripUpdates but not Vehicles, so there are no live GPS pings
  for trams.
- A future Luas implementation should use TripUpdates-driven interpolation:
  combine scheduled stop times with delays, find the current segment, then
  interpolate along the Luas shape.
- A small precomputed Luas schedule DB will be needed for stop times.

## Geolocation Notes

- Prior Android Chrome testing showed little practical benefit from a two-stage
  coarse/fine geolocation approach.
- Do not reintroduce coarse-to-fine geolocation without fresh evidence. The more
  useful lever is caching the last fix and painting it instantly while waiting
  for a fresh fix.

## Performance Context

- Remaining performance constraints are mostly structural: Leaflet bundle
  behavior, raster map tile LCP under throttling, and render-blocking resources.
- Real-user experience on normal Wi-Fi or mobile networks can be better than
  synthetic slow-network benchmarks suggest.
