# Púca

Real-time bus and train tracker for Ireland — a shapeshifting spirit of Irish folklore watching vehicles flit across the island in real time.

Live at [puca.dev](https://puca.dev).

## What it is

A vehicle-centric PWA. Live positions of Dublin Bus, Bus Éireann, Go-Ahead, and Irish Rail trains rendered on a map you can pan, cluster, and tap to inspect. Built for the moment you're physically at a stop and want to see what's coming.

## Stack

- **Runtime**: Bun (server + bundler, no separate build step)
- **Frontend**: Preact + TypeScript, Leaflet + leaflet.markercluster
- **Data**: NTA GTFS-Realtime feed (buses), Irish Rail API (trains), SQLite for static GTFS schedule
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

Schedule databases ([src/data/](src/data/)) are gitignored. Generate them from the raw GTFS feeds in [gtfs/](gtfs/) with the scripts in [scripts/](scripts/):

```bash
python scripts/gen_bus_schedule_sqlite.py     # Dublin Bus
python scripts/gen_buseireann_schedule.py     # Bus Éireann
python scripts/gen_goahead_schedule.py        # Go-Ahead
```

## Deploy

```bash
fly deploy
```

For replacing a schedule DB on the Fly volume without a full redeploy (atomic rename + restart), see the **Fly.io deployment** section in [CLAUDE.md](CLAUDE.md).

## Layout

- [server.ts](server.ts) — `Bun.serve` entry, rate limiting, all `/api/*` routes
- [src/api.ts](src/api.ts) — Irish Rail train data
- [src/gtfsr.ts](src/gtfsr.ts) — NTA GTFS-R bus feed + background poller
- [src/components/](src/components/) — Preact UI (map, search, info panel, favorites)
- [src/data/](src/data/) — SQLite schedule DBs (gitignored, lives on Fly volume in prod)
- [scripts/](scripts/) — GTFS → SQLite generators, splash screen builder
- [docs/nta-feed-history.md](docs/nta-feed-history.md) — log of NTA feed schema rolls

## Notes

- Personal / portfolio project, not a product. No telemetry, no accounts; favorites live in `localStorage`.
- The NTA GTFS-R feed periodically rolls its `feed_id` UUID, which can break route matching — see [docs/nta-feed-history.md](docs/nta-feed-history.md) when arrivals stop showing.
