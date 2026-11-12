# Fly Schedule DB Update Flow

This document describes how to upload regenerated SQLite schedule databases to
the Fly volume at `/data`.

Static JSON data is shipped through `fly deploy`. The `src/data/*.db` files are
excluded by both `.gitignore` and `.dockerignore`, so they must be uploaded to
the Fly volume separately.

## GitHub Actions Update

Use `Prepare data update PR` for a new NTA feed. Production data changes only
after its PR passes checks, merges, and the main deployment runs. Large DBs are
generated and uploaded by the GitHub runner.

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

1. Download and extract the latest `GTFS_Realtime.zip`.
2. Parse its `feed_info.txt` and the repository marker with the same CSV parser.
3. Generate JSON and update the marker only when the feed version changes.
4. Check for source and schedule archives even when the feed version is unchanged.
5. Archive a missing source zip as `nta-gtfs-<feed_version>` for 90 days.
6. For a missing schedule artifact, verify the feed/route IDs, generate all three
   DBs, and run SQLite integrity and nonempty row-count checks.
7. Archive the checked DBs with a manifest of input and DB SHA-256 checksums.
   The artifact name contains the feed version and an input fingerprint, including
   bus JSON and schedule generator scripts. Retention is 90 days.
8. Restore and verify the artifact, then open the data PR (or reuse an existing
   open PR) and enable auto-merge. No Fly access or production writes happen here.

The required `test` job for `bot/nta-data-*` branches also restores the artifact
and verifies it matches that PR before merging. Existing data branches must be
updated with main to receive changed tests and workflow checks.

After merge, `CI / Deploy` will:

1. Run tests, type checking, lint, audit, and build checks.
2. Skip a deployment superseded by a newer main commit.
3. Compare bus data, the feed marker, and DB generator scripts against the last
   successful main deployment. This also catches data changes from a failed or
   cancelled deployment; comparing only the immediately previous push would not.
4. Only when schedules changed, download the matching pre-merge artifact and
   verify its inputs, DB checksums, integrity, and row counts before deployment.
   A missing artifact stops the data deployment; there is no fallback to a newer
   NTA feed. Ordinary code pushes need no archive and do not replace DBs.
5. Deploy the app image. If schedules changed, run `bun run db:upload`: delete old
   DBs and `.new` leftovers, restart to release handles, upload and verify all
   replacements, then restart again.

Deployment and manual DB uploads share a concurrency group. The app deployment
and DB upload are sequential, so brief schedule lookup downtime is still expected.
A failed upload requires a retry; this is not an atomic deployment or automatic
rollback. Run `CI / Deploy` on current main with `replace_schedules` enabled to
retry the entire app/DB deployment, or run `Repair schedule deployment` on main. The repair entry point reuses the
full checked app/DB deployment, rather than uploading DBs against an unknown app
version. Both restore checked artifacts.

If an archive is missing or expired, rerun `Prepare data update PR` to backfill
it, even when the repository already has that feed marker. If NTA has moved on,
prepare and deploy the newer data PR rather than uploading a newer feed to an
older app. Do not bypass the version and checksum checks.

## Rolling Out This Workflow Change

For the existing November 11 incident, land only `tests/gtfsr.test.ts` first.
Update #251 with that test fix, let required checks pass, merge it, and confirm
the existing app deployment restores matching live vehicle routes. The existing
workflow has already uploaded that feed's DBs; do not replace them again to fix
its failing tests.

Land this workflow refactor separately after recovery. Since it does not change
bus data, its first main deployment skips DB restoration/upload and does not
require a legacy artifact. Then run `Prepare data update PR` to backfill the
current feed's archives. New feeds will be checked and archived before their
PRs are created.

The tracked `.github/data/feed_info.txt` file is the repository's "processed
feed" marker. It replaced the older `.github/data/last-feed-uuid` marker while
preserving the full `feed_info.txt` contents.

`Prepare data update PR` runs daily at 00:00 UTC and can also be run manually.
When deciding whether to continue, the
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
