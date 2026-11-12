# Data release refactor — review guide

This PR preserves the daily update schedule and changes no production state
until it is merged. PR #251's test fix and data recovery were completed
separately; this refactor builds on that recovered main.

## Release contract

- Preparation generates JSON and DBs from the same extracted GTFS zip, validates
  feed version/route IDs and SQLite integrity/nonempty rows, and archives DBs
  before opening a PR or enabling auto-merge. It never accesses Fly.
- Schedule artifact identity includes the feed marker, bus JSON, and DB generator
  scripts. A manifest verifies all inputs and DB checksums before local restore.
- Bot PR checks restore the artifact to detect changed inputs before merge.
- Main deployment compares against the last successful main release. Code-only
  deployments skip DB work. Failed data releases remain eligible for retry on
  later pushes; missing history requires checked DBs instead of guessing.
- Artifact restoration finishes before application deployment. DB upload happens
  only after app deployment succeeds. The shared deployment lock covers both.
- Manual repair reuses this complete release with DB replacement forced. It
  cannot upload DBs alone against an app whose deployment failed.
- Superseded main runs fail before deployment, so they neither overwrite newer
  main nor masquerade as a successful production baseline.

## First rollout

1. Reconcile with recovered main (#251), preserving its current JSON/feed marker.
2. Review and publish the workflow refactor separately. Existing successful main
   deployment history provides the baseline, so unchanged bus data needs no
   legacy schedule archive and does not replace production DBs.
3. Run preparation to backfill archives. Identical feed versions still check for
   missing archives. If NTA has advanced, preparation opens the next checked PR.
4. Observe that next feed's preparation, PR checks, deployment, and matching
   vehicles/arrival queries before considering the runtime rollout verified.

## Failure and recovery

| Failure | Behavior | Recovery |
|---|---|---|
| Feed or route ID mismatch | Preparation fails before PR creation/production writes | Investigate source and generated JSON |
| DB generation/integrity check fails | No new checked DB artifact; no auto-merge step | Fix generator/source, rerun preparation |
| Missing/expired archive | Data deployment stops before app deployment | Backfill using preparation; if feed has advanced, prepare that feed |
| Changed input or damaged DB artifact | Restore rejects before deployment | Regenerate matching artifact; remove damaged artifact if necessary |
| Application deployment fails | DB upload does not start | Retry current main after fixing failure |
| DB upload fails partway | Workflow fails; schedule queries may be unavailable | Run repair on current main; all DBs are replaced again |
| Ordinary code push after failed data deployment | Data difference against last success still triggers upload | No manual reset of a marker is needed |

## Verification and limits

Local checks cover the actual release decision shell with mocked GitHub/remote
Git commands: failed-data retry, ordinary code skip, forced repair, superseded
run refusal, and missing history. Bundle tests cover input binding, checksums,
incomplete/empty data, quoted CSV, and restoring matching DBs. Full project
checks and actionlint also run; these are not a substitute for the first real
GitHub/Fly release after review.

Archives retain 90 days. App and DB replacement remain sequential, not atomic;
there is brief schedule lookup downtime during DB upload and no automatic rollback.
GitHub can replace pending concurrency jobs, which is why every later release
compares against the last successful deployment rather than the previous push.
Manual Fly deploys outside these workflows are not represented by that history;
use forced repair if production has been changed outside the managed path.
