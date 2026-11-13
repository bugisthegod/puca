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
2. Fail a deployment superseded by a newer main commit before production changes.
   It must not count as a successful deployment baseline.
3. Compare bus data, the feed marker, and DB generator scripts against the last
   successful main deployment. This also catches data changes from a failed or
   cancelled deployment; comparing only the immediately previous push would not.
4. Only when schedules changed, download the matching pre-merge artifact and
   verify its inputs, DB checksums, integrity, and row counts before deployment.
   A missing artifact stops the data deployment; there is no fallback to a newer
   NTA feed. Ordinary code pushes need no archive and do not replace DBs.
5. Deploy the app image. If schedules changed, run `bun run db:upload`: identify
   the single app machine mounting `/data`, start it if stopped or suspended,
   and wait for the started state and SSH readiness before deleting anything.
   All SSH, SFTP, and restart commands target that same machine. Missing or
   multiple volume owners stop the replacement for operator review. Delete old
   DBs and `.new` leftovers, restart to release handles, upload and verify all
   replacements, then restart again. Wait for SSH readiness after each restart.

Automatic and manually triggered deployments share a concurrency group. The
app deployment and DB upload are sequential, so brief schedule lookup downtime
is expected. A failed upload requires a retry; there is no atomic replacement
or automatic rollback.

## Retry or Repair a Release

Use the same workflow as automatic deployment so successful repairs advance the
same deployment baseline:

1. Open **Actions → CI / Deploy → Run workflow**.
2. Select **main**.
3. Enable **replace_schedules** to restore and upload the verified DBs even if
   the data diff is empty (for example, after a partial upload or manual change).
4. Run the workflow and confirm both Test and Deploy succeed.

The workflow verifies the artifact, deploys the corresponding app, and only then
uploads DBs. Do not use standalone `fly deploy`, `fly sftp put`, or
`bun run db:upload` as the normal release/repair path; these bypass its release
checks and success baseline. The upload script remains an internal workflow step.

If an archive is missing or expired, rerun `Prepare data update PR` to backfill
it, even when the repository already has that feed marker. If NTA has moved on,
prepare and deploy the newer data PR rather than uploading a newer feed to an
older app. Do not bypass the version and checksum checks.

## Initial Adoption

Ensure current main's app and DBs have recovered and its successful deployment
is recorded before adopting this flow. If bus data and generators are unchanged,
the first deployment needs no legacy archive and skips DB replacement. If they
changed, matching verified artifacts are required before deployment.

Run `Prepare data update PR` to backfill current feed archives. If NTA has
advanced, it will prepare a checked PR for that newer feed instead. Observe the
next feed's preparation, checks, deployment, live vehicles, and arrival lookups
to verify the complete hosted flow.

## Schedule and Feed Marker

`Prepare data update PR` runs daily at 00:00 UTC and can also run manually. The
tracked `.github/data/feed_info.txt` is the processed-feed marker. Preparation
reads metadata from the full downloaded zip, not the lightweight feed endpoint.

## Post-release Verification

Confirm the deployment workflow succeeds. During bus service hours, inspect
`/api/bus/vehicles/all`: fresh data should report `X-Puca-Realtime-Status: ok`
and a nonzero matched vehicle count when raw vehicles are present. Also test a
stop arrival lookup; HTTP 200 on the homepage alone does not verify schedules.
A short empty-cache period immediately after restart is expected.

See [Data release design](data-release-review.md) for artifact binding, failure
behavior, and limitations.
