# Puca

Puca is a live Dublin public transport map for buses and trains. It shows realtime vehicle positions, nearby stops, route search, train station arrivals, favorites, and map-based journey context for people waiting at a stop.

Live app: https://puca.dev/

## What It Is

Puca is a vehicle-centric PWA for Irish public transport. It shows live positions for Dublin Bus, Bus Eireann, Go-Ahead, and Irish Rail trains on a map, with enough stop and arrival context to answer the question: "I am here right now. Where is my bus or train?"

## Features

- Live bus positions from the NTA GTFS-Realtime Vehicles feed.
- Live train positions and station movement data from Irish Rail.
- Bus route filtering by operator, route, and direction.
- Bus stop search by stop number or name.
- Stop arrival boards with scheduled and realtime context.
- Focus mode for tracking a selected bus arrival.
- Train station-to-station search.
- Favorites for bus routes, bus stops, and train searches.
- Installable PWA shell.
- English and Chinese UI.

## Boundaries

Puca is not a journey planner, ticketing product, fare calculator, or account-based service. It prioritizes live vehicle map context over multi-leg planning.

## Stack

Puca is built with Bun, Preact, TypeScript, Leaflet, NTA GTFS-Realtime data, Irish Rail APIs, generated GTFS JSON, and SQLite schedule artifacts. It is hosted on Fly.io.
