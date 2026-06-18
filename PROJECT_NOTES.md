# Puca Project Notes

This file keeps durable project context for future maintenance work. It is
intended to be safe for a public repository.

## Product Shape

- Puca is a real-time public transport tracking app for Ireland, centered on
  live vehicle positions on a map.
- It is vehicle-centric, not stop-centric. Arrival/countdown features may exist,
  but the core value is seeing where the bus or train is right now, with Luas
  presented as timetable-based stop context.
- The main user context is being physically at a stop, platform, or nearby
  street corner and wanting to know what is actually moving.
- Puca currently supports bus, Irish Rail/DART, and Luas. Luas support is
  timetable/arrival-context only, not GPS-tracked tram movement.
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

## State Rules

- Search state lives in `sessionStorage`.
  Train, bus, and Luas search state should disappear when the tab closes.
- Favorites live in `localStorage`.
  They are explicit bookmarks curated by the user.
- Long-lived app state lives in `localStorage`.
  Mode, selected bus operator, map view, language, compass preference, and recent
  location cache belong here.
- When adding new state, decide which bucket it belongs to before writing code.
  If unsure, search-like state should usually be session-scoped.

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

## Repository Layout

- `src/server/index.ts`: `Bun.serve` entrypoint, static files, rate limiting,
  and API routes.
- `src/client/App.tsx`: top-level app state, mode switching, search/favorites wiring,
  and map UI chrome.
- `src/api.ts`: Irish Rail API client and train data normalization.
- `src/gtfsr.ts`: public barrel for GTFS/static/realtime helpers.
- `src/gtfsr/`: bus schedules, GTFS-R caches, arrivals, trip merging, realtime
  health, and train shape helpers.
- `src/client/hooks/`: Leaflet map lifecycle, marker animation, route projection, focus
  segments, geolocation, favorites, and toasts.
- `src/client/components/`: Preact UI for search panels, info panel, favorites, modals,
  banners, and onboarding.
- `src/client/styles/`: split CSS for map UI, popups, panels, settings, stop/arrival
  UI, markers, offline banners, and toasts.
- `src/data/`: generated static JSON plus local gitignored schedule DBs.
- `tests/`: Bun tests for realtime merging, polling, popups, animation,
  persistence, favorites, and UI helpers.
- `scripts/`: GTFS check/generation scripts, SQLite builders, Fly DB upload
  helper, and splash generation.
- `docs/`: operational notes and feed history.

## Luas Notes

- Luas agency prefix observed in NTA data: `5242`.
- Luas appears in TripUpdates but not Vehicles, so there are no live GPS pings
  for trams.
- Current Luas UI uses generated static stop and timetable JSON for stop search
  and arrival context.
- Future Luas movement on the map would need TripUpdates-driven interpolation:
  combine scheduled stop times with delays, find the current segment, then
  interpolate along the Luas shape.

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
