# Puca Project Memory

This file summarizes project-specific context originally kept in Claude's hidden
project memory. Treat it as durable working context for future agents.

## Product Shape

- Puca is a real-time public transport tracking app for Ireland, centered on
  live vehicle positions on a map.
- It is vehicle-centric, not stop-centric. Arrival/countdown features may exist,
  but the core value is seeing where the bus or train is right now.
- The main user context is "physically at the stop/platform right now", not
  planning from home. Avoid heavy discovery UX for cases where the real-world
  sign already gives the stop number.
- Puca currently supports bus and Irish Rail/DART. Luas is not supported yet.
- Do not add schedule-only operators that lack GTFS-Realtime vehicle/trip data;
  that would dilute the real-time value proposition.

## Project Goals

- Puca is primarily a personal-use and portfolio/showcase project, not a growth
  product or commercial service.
- Do not pitch marketing, growth funnels, analytics platforms, multi-region
  scaling, or user acquisition strategy unless explicitly asked.
- As of 2026-06-01, daily usage is around 25-30 users. Treat load-related issues
  as code/data problems first, not traffic problems.
- The owner accepts occasional Fly.io OOM restarts on the smallest tier for now.
  Prefer code-level fixes over paid scaling suggestions.

## Development Preferences

- Default to Bun commands and Bun APIs as described in `AGENTS.md`.
- Prefer simple event-driven fixes over continuous real-time recomputation when
  behavior can be captured by one-shot events like focus/blur/open/close.
- For responsive UI space issues, shrink fonts, padding, and gaps before hiding,
  clipping, truncating, or adding scroll.
- For visual/UI changes, describe what changed and let the user judge. Do not
  pre-declare that the result looks good.
- Exploratory questions are not action commands. If the user asks "can we...?",
  "why...?", or "how would we design...?", answer and wait for explicit approval
  before editing.
- Do not auto-commit visual or user-verified changes. Make the change, describe
  it, and commit only after the user confirms or explicitly asks.

## Local Testing Hygiene

- Before committing code changes, run `bun run typecheck`, `bun run lint`, and
  `bun test`; commit only after all three pass.
- If starting a dev server on port 3000, first check whether something is already
  listening. If it is the user's server, do not kill it.
- If starting a server for testing, track and kill that specific process before
  finishing so port 3000 is free.
- Remove scratch files created during investigation, especially `/tmp` downloads,
  partial zips, curl dumps, or ad-hoc temp files.

## Production And Fly.io

- Production/shared-infra changes require explicit authorization. Do not run
  `fly deploy`, `fly scale`, `git push`, DB volume mutations, rollback, or other
  shared production changes unless the user clearly says to execute.
- Supporting evidence such as screenshots, billing info, or "cost is not an
  issue" does not count as authorization.
- For Fly schedule DB uploads, use the strict serial flow:
  `sftp put <db>.new` -> atomic `mv` rename -> next DB -> final app restart.
- Do not run sqlite3 verification or md5 verification during DB upload. The
  production image may not have sqlite3, and the user has rejected the extra
  verification loop.
- If a partial `.new` remains after failed upload, clean it before retrying.

## Data And GTFS Notes

- NTA GTFS/GTFS-R route IDs can drift. Diagnose before regenerating data.
- Known NTA drift modes:
  - Static and realtime roll route prefixes together.
  - Static route_id schema changes while trip_id and shape_id remain stable.
  - Realtime moves ahead of static temporarily, causing route_id mismatches even
    when trip_id still matches.
  - Lightweight `feed_info.txt` updates before the full zip is republished.
- When users report 0 buses while Fly logs show vehicles, compare live
  `feed_info.txt` with local `gtfs/feed_info.txt` before recommending regen.
- If the zip `Last-Modified` has not changed even though lightweight
  `feed_info.txt` has, wait; regeneration will fetch the old zip.
- Historical notes live in `docs/nta-feed-history.md`.

## Luas Future Work

- Luas agency prefix observed in NTA data: `5242`.
- Luas appears in TripUpdates but not Vehicles, so there are no live GPS pings
  for trams.
- A future Luas implementation should use TripUpdates-driven interpolation:
  combine scheduled stop times with delays, find the current segment, then
  interpolate along the Luas shape.
- A small precomputed Luas schedule DB will be needed for stop times.

## Geolocation Findings

- Android Chrome effectively ignores `enableHighAccuracy: false` for the tested
  two-stage coarse/fine geolocation approach.
- Both coarse and fine calls returned the same fused location fix around 1.3s
  after request in testing.
- Do not reintroduce a two-stage coarse-to-fine geolocation strategy without new
  evidence. The useful lever is caching the last fix and painting it instantly
  while waiting for a fresh fix.

## Performance Context

- Lighthouse performance has reached roughly the high 80s in past measurement.
- Remaining performance gaps are structural: Leaflet bundle behavior, raster map
  tile LCP under throttling, and render-blocking resources.
- Do not promise 90+ Lighthouse without a larger map-engine rewrite such as
  moving away from Leaflet/raster-tile constraints.
- Real-user experience on normal Wi-Fi/4G can be better than Lighthouse's Slow
  4G model suggests.

## User Background

- The owner has a Java foundation and is comfortable with TypeScript, React,
  Bun, PWAs, and modern frontend tooling.
- Mobile native development is newer territory. When explaining mobile topics,
  assume general programming fluency but explain platform-specific concepts.
