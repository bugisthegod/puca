# Puca

Puca is a live Dublin public transport map for buses, trains, and Luas. It shows realtime vehicle positions, nearby stops, route search, train station arrivals, Luas timetable arrivals, favorites, and map-based journey context for people waiting at a stop or platform.

Live app: https://puca.dev/

## What It Is

Puca is a vehicle-centric PWA for Irish public transport. It shows live positions for Dublin Bus, Bus Eireann, Go-Ahead, and Irish Rail trains on a map, plus Luas stop search and timetable-based arrivals, with enough context to answer the question: "I am here right now. Where is my bus, train, or tram?"

## Features

- Live bus positions from the NTA GTFS-Realtime Vehicles feed.
- Live train positions and station movement data from Irish Rail.
- Luas Green Line and Red Line stop search with timetable-based arrivals.
- Bus route filtering by operator, route, and direction.
- Bus stop search by stop number or name.
- Stop arrival boards with scheduled and realtime context.
- Focus mode for tracking a selected bus arrival.
- Train station-to-station search.
- Favorites for bus routes, bus stops, train searches, and Luas stops.
- Installable PWA shell.
- English and Chinese UI.

## Boundaries

Puca is not a journey planner, ticketing product, fare calculator, or account-based service. It prioritizes live vehicle map context over multi-leg planning.

## Stack

Puca is built with Bun, Preact, TypeScript, Leaflet, NTA GTFS-Realtime data, Irish Rail APIs, generated GTFS JSON, generated Luas timetable data, and SQLite schedule artifacts. It is hosted on Fly.io.
