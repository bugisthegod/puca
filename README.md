# Púca

Real-time bus and train tracker for Ireland — a shapeshifting spirit of Irish folklore watching vehicles flit across the island in real time.

Live at [puca.dev](https://puca.dev).

<p align="center">
  <img src="docs/puca-mobile-bus.png" alt="Púca mobile map showing live buses in Dublin" width="360">
</p>

Púca is a vehicle-centric PWA for Irish public transport. It shows live positions for Dublin Bus, Bus Éireann, Go-Ahead, and Irish Rail trains on a map, with stop and arrival context for the moment you are already waiting nearby.

It is not a journey planner, ticketing product, or transport marketplace. The core question is simple:

> Where is my bus or train right now?

## Features

- Live bus positions from NTA GTFS-Realtime feeds.
- Live train positions and station movement data from Irish Rail.
- Route filtering, stop search, stop arrivals, and focused bus tracking.
- Train station-to-station search with focused train tracking where live position data exists.
- Favorites for bus routes, bus stops, and train searches.
- Offline/PWA shell with English and Chinese UI.

## Stack

- **Runtime**: Bun with `Bun.serve()`
- **Frontend**: Preact + TypeScript
- **Map**: Leaflet + `leaflet.markercluster`
- **Data**: NTA/TFI GTFS, GTFS-Realtime, and Irish Rail APIs
- **Hosting**: Fly.io

## Develop

Prerequisites:

- Bun 1.3 or newer.
- Python 3 for GTFS data-generation scripts.
- An NTA API key from [developer.nationaltransport.ie](https://developer.nationaltransport.ie/).

Install dependencies:

```bash
bun install
```

Create a local environment file:

```bash
cp .env.example .env
```

Then set `NTA_API_KEY` in `.env`.

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

Build:

```bash
bun run build
```

## Data

Generated static JSON lives in `src/data/`. Local schedule SQLite databases are generated into `src/data/`, ignored by Git, and stored on the Fly volume in production.

Common data commands:

```bash
bun run db:check
bun run json:generate
bun run db:generate
```

Operational notes live in [docs/](docs/). Project maintenance context lives in [PROJECT_NOTES.md](PROJECT_NOTES.md).

## Contributions

Púca is maintained as a personal open-source project. External pull requests are not accepted at this time, but issues and bug reports are welcome.

## License

Púca is licensed under the GNU Affero General Public License v3.0 only.
See [LICENSE](LICENSE).
