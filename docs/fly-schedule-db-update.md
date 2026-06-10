# Fly Schedule DB Update Flow

This document describes how to upload regenerated SQLite schedule databases to
the Fly volume at `/data`.

Static JSON data is shipped through `fly deploy`. The `src/data/*.db` files are
excluded by both `.gitignore` and `.dockerignore`, so they must be uploaded to
the Fly volume separately.

## GitHub Actions Update

For schedule DB-only updates, use the GitHub runner to download the NTA GTFS
feed, generate the DBs, and upload them to the Fly volume. This avoids slow local
uploads of large files.

Before first use:

```bash
fly tokens create deploy -a puca
```

Save the output as a GitHub repository secret:

- `Settings` -> `Secrets and variables` -> `Actions`
- Create `FLY_API_TOKEN`

Run manually:

- Open the repository `Actions` tab.
- Select `Prepare data update PR`.
- Click `Run workflow`.

`Prepare data update PR` will:

1. Download the latest `GTFS_Realtime.zip`.
2. Extract it into the runner's `gtfs/` directory.
3. Compare the zip's `feed_info.txt` `feed_version` with `.github/data/feed_info.txt`.
4. Exit early when the versions match.
5. Run `bun run json:generate` when the version differs or the marker is missing.
6. Put `src/data/*.json` and `.github/data/feed_info.txt` into the same PR.
7. Continue without waiting for the PR to merge, then run `bun run db:generate`.
8. Run `PRAGMA integrity_check` and row-count checks on all three SQLite DBs.
9. Run `bun run db:upload`.
10. Delete the three live DB files and any leftover `.new` files in `/data`.
11. Restart the Fly app to release deleted SQLite file handles.
12. Upload the three new DBs directly to their final filenames and verify remote file sizes.
13. Restart the Fly app once more so the process opens the replacement DBs.

The tracked `.github/data/feed_info.txt` file is the repository's "processed
feed" marker. It replaced the older `.github/data/last-feed-uuid` marker while
preserving the full `feed_info.txt` contents.

There is no automatic feed checker. The entry point is the manual
`Prepare data update PR` workflow. When deciding whether to continue, the
workflow downloads the full zip and reads the `feed_info.txt` inside it. Do not
use the lightweight `feed_info.txt` endpoint for this decision.

If NTA route, stop, or shape JSON also changed, do not run only the DB workflow.
Update JSON first, deploy normally with `fly deploy`, then update the volume DBs.

## Recommended Order

If JSON changed, deploy the image first:

```bash
fly deploy
```

Then upload the DBs. The upload flow intentionally causes brief schedule lookup
downtime: delete the three old DBs, restart to release deleted SQLite handles,
upload the three new DBs directly, then restart once more.

## Preflight

```bash
fly machine list -a puca
fly ssh console -a puca -C "sh -c 'df -h /data && ls -la /data/'"
```

Confirm:

- The machine is `started`.
- `/data` will have enough space for the three new DBs after the old DBs are deleted.
- No `.new` files remain from a failed previous upload.

## Upload And Replace

```bash
# 1. Delete old DBs and failed-upload leftovers.
fly ssh console -a puca -C "rm -f /data/bus-schedule.db /data/buseireann-schedule.db /data/goahead-schedule.db /data/bus-schedule.db.new /data/buseireann-schedule.db.new /data/goahead-schedule.db.new"

# 2. Restart to release handles to deleted files.
fly apps restart puca

# 3. Upload directly to final filenames.
fly sftp put src/data/bus-schedule.db /data/bus-schedule.db -a puca
fly sftp put src/data/buseireann-schedule.db /data/buseireann-schedule.db -a puca
fly sftp put src/data/goahead-schedule.db /data/goahead-schedule.db -a puca

# 4. Restart once more.
fly apps restart puca
```

## Retry After Failure

If `fly sftp put` disconnects mid-upload, schedule lookup may remain
unavailable. Rerun:

```bash
bun run db:upload
```

The script deletes all three DBs and `.new` leftovers again, then performs a full
upload.

## Final Check

```bash
fly ssh console -a puca -C "sh -c 'ls -lh /data && df -h /data'"
fly machine list -a puca
curl -I https://puca.dev
```

`/data` should contain only the final DB files, with no `.new` leftovers.
`puca.dev` should return `HTTP/2 200`.
