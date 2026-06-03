
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Lint

Use Biome for linting and formatting:

- `bun run lint` — check only (CI)
- `bun run lint:fix` — auto-fix (safe + unsafe)

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Fly.io deployment

### Replacing SQLite DBs on the Fly volume

`src/data/*.db` is excluded by both `.gitignore` and `.dockerignore`, so `fly deploy` never touches schedule DBs on the `/data` volume. DB upload intentionally accepts brief schedule lookup downtime: delete all live DBs, restart to release deleted SQLite file handles, upload all three replacement DBs directly to their final names, then restart once.

```bash
APP=puca

# 1. Wake machine if auto-stopped
fly machine list -a $APP
fly machine start <machine-id> -a $APP

# 2. Preflight
fly ssh console -a $APP -C "sh -c 'df -h /data && ls -la /data/'"

# 3. Delete old DBs and any failed-upload leftovers
fly ssh console -a $APP -C "rm -f /data/bus-schedule.db /data/buseireann-schedule.db /data/goahead-schedule.db /data/bus-schedule.db.new /data/buseireann-schedule.db.new /data/goahead-schedule.db.new"

# 4. Restart so deleted inodes are released
fly apps restart $APP

# 5. Upload replacements directly to final names
fly sftp put src/data/bus-schedule.db /data/bus-schedule.db -a $APP
fly sftp put src/data/buseireann-schedule.db /data/buseireann-schedule.db -a $APP
fly sftp put src/data/goahead-schedule.db /data/goahead-schedule.db -a $APP

# 6. Restart once so app opens the replacements
fly apps restart $APP
```

Auto-stop (`auto_stop_machines = 'stop'`) watches HTTP idleness, not SSH. Multi-minute uploads generally complete fine; if interrupted mid-upload, rerun `bun run db:upload`.

## Persistence rules

- **Search state lives in `sessionStorage` only.** Train search (from/to/queries) and bus search (route/direction/tab/stopId/stopOperator/routeQuery/stopQuery) must never be written to `localStorage`. They die when the tab closes.
- **Favorites live in `localStorage`.** `src/favorites.ts` persists user-curated bookmarks. Never move favorites to `sessionStorage`.
- **Long-lived app state lives in `localStorage`.** `src/session.ts` `Session` interface covers mode, filter, bus operator, and map view. Opening the app should restore where the user left off.
- When adding new state, decide upfront which bucket it belongs to. If unsure, search state goes to sessionStorage.

## React patterns

- **Don't default to `useEffect`.** Before adding an effect, ask: can this be solved by changing a prop/state in the event handler instead? Many "reactive" behaviors (e.g. collapsing a panel when a condition is true) are better handled directly where the action happens — no effect, no async, no timing uncertainty.
- A `useEffect` that synchronizes two pieces of state is often a sign the design can be simplified.
