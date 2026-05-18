# Púca

Real-time bus and train tracker for Ireland — a shapeshifting spirit of Irish folklore watching vehicles flit across the island in real time.

Live at [puca.dev](https://puca.dev).

## What it is

A vehicle-centric PWA. Live positions of Dublin Bus, Bus Éireann, Go-Ahead, and Irish Rail trains rendered on a map you can pan, cluster, and tap to inspect. Built for the moment you're physically at a stop and want to see what's coming.

## Stack

- **Runtime**: Bun (server + bundler, no separate build step)
- **Frontend**: Preact + TypeScript, Leaflet + leaflet.markercluster
- **Data**: NTA GTFS-Realtime feed (buses), Irish Rail API (trains), TFI/NTA static GTFS for shapes/schedules
- **Hosting**: Fly.io, single 256 MB shared VM, persistent volume at `/data` for schedule DBs

## Develop

```bash
bun install
bun --hot ./server.ts
```

Open http://localhost:3000.

### Lint

```bash
bun run lint       # check only
bun run lint:fix   # auto-fix
```

Static data comes from the TFI/NTA GTFS feed in [gtfs/](gtfs/). `bun run db:check` downloads the latest feed, checks route and schedule counts, and refreshes the local GTFS `.txt` files when the feed changed.

Generated JSON in [src/data/](src/data/) is committed and includes bus shapes/stops/routes plus train static shapes. Train realtime still comes from the Irish Rail API; the train shape JSON is only used for route geometry because Irish Rail realtime does not provide full polylines.

```bash
bun run db:check
bun run json:generate
```

Schedule databases ([src/data/](src/data/)) are gitignored and live on the Fly volume in production. Generate them from the same GTFS feed with:

```bash
bun run db:generate
```

## Deploy

```bash
fly deploy
```

For replacing a schedule DB on the Fly volume without a full redeploy (atomic rename + restart), see the **Fly.io deployment** section in [CLAUDE.md](CLAUDE.md).

## Layout

- [server.ts](server.ts) — `Bun.serve` entry, rate limiting, all `/api/*` routes
- [src/api.ts](src/api.ts) — Irish Rail train data
- [src/gtfsr.ts](src/gtfsr.ts) — public barrel for GTFS/static/realtime helpers
- [src/gtfsr/](src/gtfsr/) — bus static schedules, GTFS-R caches, arrivals, vehicle enrichment, realtime health, train static shapes
- [src/components/](src/components/) — Preact UI (map, search, info panel, favorites)
- [src/data/](src/data/) — committed static JSON plus local SQLite schedule DBs (DBs are gitignored)
- [scripts/](scripts/) — GTFS refresh/check scripts, JSON/SQLite generators, splash screen builder
- [docs/nta-feed-history.md](docs/nta-feed-history.md) — log of NTA feed schema rolls

## Notes

- Personal / portfolio project, not a product. No telemetry, no accounts; favorites live in `localStorage`.
- The NTA GTFS-R feed periodically rolls its `feed_id` UUID, which can break route matching — see [docs/nta-feed-history.md](docs/nta-feed-history.md) when arrivals stop showing.
