# Púca

Real-time bus and train tracker for Ireland — a shapeshifting spirit of Irish folklore watching vehicles flit across the island in real time.

Live at [puca.dev](https://puca.dev).

<p align="center">
  <img src="docs/puca-mobile-bus.png" alt="Púca mobile map showing live buses in Dublin" width="360">
</p>

## What It Is

Púca is a vehicle-centric PWA for Irish public transport. It shows live positions for Dublin Bus, Bus Éireann, Go-Ahead, and Irish Rail trains on a map, with enough stop and arrival context to answer the question:

> I'm here right now. Where is my bus or train?

It is built for the moment when you are physically at a stop, platform, or nearby street corner and want to see what is actually moving. Route search, stop arrivals, favorites, and focused tracking all support that core map experience.

## What It Is Not

Púca is deliberately not a journey planner, transport marketplace, or growth product.

- No accounts.
- No server-side user profiles.
- No ticketing, fares, or payments.
- No multi-leg trip planning.
- No schedule-only operators unless they can support the real-time map experience.
- No Luas support for now: Luas does not currently provide vehicle GPS positions in the same way bus and train feeds do. A future Luas implementation would need to be clearly presented as estimated/interpolated, not GPS-tracked.

## Features

- Live bus positions from the NTA GTFS-Realtime Vehicles feed.
- Live train positions and station movement data from Irish Rail.
- Bus route filtering by operator, route, and direction.
- Bus stop search by stop number or name, across Dublin Bus, Bus Éireann, and Go-Ahead.
- Stop arrival board with scheduled-vs-running distinction.
- Focus mode for a selected bus arrival: show only that bus, draw the segment to the target stop, and keep stops-away updated.
- Train station-to-station search, with focus on a selected train where a live position exists.
- Favorites for bus routes, bus stops, and train searches.
- Offline/PWA shell with install prompts and app icons.
- English and Chinese UI.
- Realtime health banners when upstream bus data is stale or unavailable.

## Product Boundaries

The main product shape is:

1. Show moving vehicles first.
2. Use stop/arrival UI as supporting context.
3. Prefer fast, simple interactions for someone already at the stop.
4. Keep personal state local to the device.
5. Avoid features that imply more certainty than the data supports.

When adding features, ask whether they make the live vehicle map more useful. If they mostly turn Púca into a static timetable, journey planner, or generic transit app, they probably do not belong here.

## Stack

- **Runtime**: Bun, using `Bun.serve()` for the app and API server.
- **Frontend**: Preact + TypeScript.
- **Map**: Leaflet + `leaflet.markercluster`.
- **Bus realtime**: NTA GTFS-Realtime Vehicles and TripUpdates.
- **Bus static data**: TFI/NTA GTFS, generated into JSON and SQLite artifacts.
- **Train realtime**: Irish Rail API.
- **Train static geometry**: generated train shape JSON for route drawing.
- **Hosting**: Fly.io, single small VM, with schedule SQLite databases on the `/data` volume.

## Data Model

Committed static JSON in `src/data/` includes:

- bus routes, stops, shapes, and variants
- train stations, route shapes, and endpoint indexes

Local schedule SQLite databases are generated into `src/data/`, but are gitignored and live on the Fly volume in production:

- `bus-schedule.db`
- `buseireann-schedule.db`
- `goahead-schedule.db`

The server combines static schedules, static shapes, GTFS-Realtime vehicle positions, GTFS-Realtime trip updates, and Irish Rail train APIs to produce the app's map and arrival views.

## State Rules

Púca intentionally keeps user state local.

- Search state lives in `sessionStorage`.
  Train searches and bus search state should disappear when the tab closes.
- Favorites live in `localStorage`.
  They are explicit bookmarks curated by the user.
- Long-lived app state lives in `localStorage`.
  Mode, selected bus operator, map view, language, compass preference, and recent location cache belong here.

When adding new state, decide which bucket it belongs to before writing code. If unsure, search-like state should usually be session-scoped.

## Develop

Install dependencies:

```bash
bun install
```

Run locally:

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful checks:

```bash
bun run typecheck
bun run lint
bun test
```

Auto-fix lint/format issues:

```bash
bun run lint:fix
```

Build the static bundle:

```bash
bun run build
```

## Refresh Static Data

Static GTFS source files live in `gtfs/`.

Check/download the latest NTA feed:

```bash
bun run db:check
```

Regenerate committed JSON:

```bash
bun run json:generate
```

Regenerate local schedule SQLite databases:

```bash
bun run db:generate
```

When arrivals suddenly disappear or buses go to zero while production logs still show vehicles, diagnose GTFS feed drift before regenerating. Compare `.github/data/feed_info.txt` with `feed_info.txt` from the full GTFS zip; the lightweight feed metadata endpoint can lag behind or move ahead of the zip.

Historical feed notes live in [docs/nta-feed-history.md](docs/nta-feed-history.md).

## API Surface

The app server is `server.ts`. Important routes include:

- `/api/trains`
- `/api/station/:code`
- `/api/trains/search`
- `/api/train/:id`
- `/api/train/shapes`
- `/api/bus/routes/all`
- `/api/bus/vehicles/all`
- `/api/bus/vehicles`
- `/api/bus/shape/:route`
- `/api/bus/trip/:tripId`
- `/api/bus/stops/search`
- `/api/bus/stops/nearby`
- `/api/bus/stops/bounds`
- `/api/bus/stop/:stopId/arrivals`
- `/health`
- `/api/health/details`

Most public API routes are rate-limited. Internal health routes require local/origin access.

## Deploy

Production deploys to Fly.io:

```bash
fly deploy
```

Do not mutate production or Fly volumes casually. Schedule DBs are excluded from Docker deploys and are replaced on the Fly volume with an upload-to-temp plus atomic rename flow. See [docs/fly-schedule-db-update.md](docs/fly-schedule-db-update.md) for the operational version of that process.

## Layout

- [server.ts](server.ts) — `Bun.serve` entrypoint, static files, rate limiting, and API routes.
- [src/App.tsx](src/App.tsx) — top-level app state, mode switching, search/favorites wiring, map UI chrome.
- [src/api.ts](src/api.ts) — Irish Rail API client and train data normalization.
- [src/gtfsr.ts](src/gtfsr.ts) — public barrel for GTFS/static/realtime helpers.
- [src/gtfsr/](src/gtfsr/) — bus schedules, GTFS-R caches, arrivals, trip merging, realtime health, train shape helpers.
- [src/hooks/](src/hooks/) — Leaflet map lifecycle, marker animation, route projection, focus segments, geolocation, favorites, toasts.
- [src/components/](src/components/) — Preact UI for search panels, info panel, favorites, modals, banners, onboarding.
- [src/styles/](src/styles/) — split CSS for map UI, popups, panels, settings, stop/arrival UI, markers, offline/toast states.
- [src/data/](src/data/) — generated static JSON plus local gitignored schedule DBs.
- [tests/](tests/) — Bun tests for realtime merging, polling, popups, animation, persistence, favorites, and UI helpers.
- [scripts/](scripts/) — GTFS check/generation scripts, SQLite builders, Fly DB upload helper, splash generation.
- [docs/](docs/) — operational notes and feed history.

## Maintenance Notes

- Treat low traffic as a product reality, not a scaling problem. Prefer code/data fixes over paid infrastructure changes.
- Keep the production footprint small unless performance or reliability data shows a user-visible need to scale.
- Before committing, run `bun run typecheck`, `bun run lint`, and `bun test`.
- If starting a local server on port 3000, first check whether the user already has one running.
- Do not add continuous reactive loops when an event-driven state update will do.
- Do not move search state to `localStorage`.
- Do not move favorites to `sessionStorage`.
- Do not imply GPS precision for data that is interpolated, stale, or schedule-only.

## Notes

This is a personal/portfolio project, not a company product. The point is a useful, honest, real-time map that feels good to use when you are waiting for transport in Ireland.

## Contributions

Púca is maintained as a personal open-source project. External pull requests are not accepted at this time, but issues and bug reports are welcome.

## License

Púca is licensed under the GNU Affero General Public License v3.0 only.
See [LICENSE](LICENSE).
