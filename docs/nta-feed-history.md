# NTA GTFS `route_id` Prefix Change History

Each time NTA republishes the static GTFS zip, it may assign new `route_id`
values to routes. The earlier format was `<prefix>_<number>`, with a 4-digit
prefix and a 5-6 digit suffix.

The logical routes, names, and stop order can remain the same while every string
ID is renumbered. If `*-routes.json` and `*-shapes.json` are not regenerated to
match, `getAllBusVehicles` can filter out all live vehicles.

This file records observed prefix and schema changes so future feed drift is
easier to diagnose.

## Agency Prefix Snapshot

Source: `~/Downloads/GTFS_Realtime/routes.txt`, published by NTA on
**2026-04-25** and downloaded locally on **2026-04-26**.

| agency_id | name                          | prefix | route count | notes                         |
|-----------|-------------------------------|--------|-------------|-------------------------------|
| 7778019   | Dublin Bus                    | `5570` | 116         |                               |
| 7778020   | Bus Éireann                   | `5578` | 205         | **new**, previously `5549`    |
| 7778020   | Bus Éireann                   | `5502` | 1           | Limerick 310, stable          |
| 7778008   | Bus Éireann Waterford         | `5501` | 5           | ignored by generators for now |
| 7778021   | Go-Ahead Ireland              | `5398` | 44          |                               |
| 7778006   | Go-Ahead Ireland              | `5576` | 20          |                               |
| 7778017   | Iarnród Éireann / Irish Rail  | `5609` | 18          |                               |
| 7778014   | LUAS                          | `5242` | 2           |                               |

## Change Timeline

| observed date  | agency          | old prefix | new prefix | source |
|----------------|-----------------|------------|------------|--------|
| 2026-04-14     | Bus Éireann     | -          | `5549`     | repository `./gtfs/routes.txt` mtime |
| 2026-04-17     | Bus Éireann     | `5549`     | `5549`     | unchanged; commit `56f5da7` first generated JSON |
| 2026-04-22     | Dublin Bus      | `5570`     | `5570`     | unchanged after commit `98a981a` regeneration |
| **2026-04-23** | **Bus Éireann** | `5549`     | `5578`     | new NTA GTFS zip, downloaded on 2026-04-24 |
| 2026-04-25     | all agencies    | -          | unchanged  | NTA reissued zip; prefixes did not roll |
| 2026-04-27     | Dublin Bus      | `5570`     | `5579`     | NTA zip; user had already regenerated once on 2026-04-26 |
| **2026-04-29** | **all agencies**| see below  | **schema rewrite** | NTA zip changed the `route_id` format entirely |
| 2026-04-30     | all agencies    | -          | unchanged  | NTA reissued zip with the 2026-04-29 schema |
| 2026-05-01     | all agencies    | -          | unchanged  | zip published at 22:02 UTC with UUID `3035A46D`, closing mode D; `route_id` set drift 0; `feed_start_date` moved to 20260501; `trips.txt` 126,260 -> 154,281 (+28,021), a schedule-only change |
| 2026-05-02     | -               | -          | skipped    | NTA never uploaded a 2026-05-02 zip; on 2026-05-03 22:03 UTC it jumped from `3035A46D` to `FA3F92F8`, skipping lightweight UUID `0839437A` |
| 2026-05-03     | all agencies    | -          | unchanged  | zip and lightweight marker both published `FA3F92F8`; no mode D; `route_id` set drift 0; bus trip prefix distribution unchanged; rail `5636` lost 461 trips |
| 2026-05-07     | all agencies    | -          | unchanged  | zip published at 22:03 UTC with `CE1ED411`; `route_id` set drift 0; `trips.txt` 126,264 -> 142,321 (+16,057), `stop_times.txt` +1,229,658 |
| 2026-05-11     | all agencies    | -          | unchanged  | zip published at 22:20 UTC with `110F282B`; `route_id` set drift 0; local route JSON matched the zip, so no regeneration was needed |

### 2026-05-01: Mode D, Lightweight Metadata Ahead Of The Zip

The first three observed publish modes were prefix roll, schema change, and zip
reissue without prefix changes. In all three, the zip had definitely been
re-uploaded. This case was different:

- At 22:36 UTC, the workflow saw the lightweight `feed_info.txt` UUID change to `3035A46D`.
- At the same time, `curl` against `GTFS_Realtime.zip` returned
  `Last-Modified: Thu, 30 Apr 2026 22:14:56 GMT`; the 82 MB zip had not changed.
- Extracting `feed_info.txt` from the zip still showed UUID `7255571F` from the 2026-04-30 release.

In other words, NTA updated the lightweight metadata before rebuilding and
uploading the full zip.

Impact:

- A workflow can detect the new UUID too early, when regeneration is still pointless.
- Real drift checks should wait for the zip `Last-Modified` header to advance.
- Debugging rule: when the UUID changes, check `curl -I` for the zip's
  `Last-Modified`. If it has not changed, wait.

### 2026-04-29 Was A Schema Rewrite, Not A Prefix Roll

`route_id` changed from `<4-digit-prefix>_<5-6-digit-number>` to a multi-part
space-separated code across all three bus operators:

| operator         | old                | new example          |
|------------------|--------------------|----------------------|
| Dublin Bus       | `5579_131840`      | `1 1 e a`            |
| Bus Éireann      | `5578_xxxxxx`      | `2 100 c e`          |
| Bus Éireann WFRD | `5501_xxxxxx`      | `WFRD W1 c c`        |
| Go-Ahead (3)     | `5398_xxxxxx`      | `3 102 d a`          |
| Go-Ahead (03C)   | `5576_xxxxxx`      | `03C 120 e a`        |
| Iarnród Éireann  | `5609_xxxxxx`      | `BRAY-HOWTH-I`       |
| LUAS             | `5242_1` / `5242_2`| `10000 GREEN g a`    |

The first segment roughly maps to agency: `1` for Dublin Bus, `2` for
Bus Éireann, `3` and `03C` for the two Go-Ahead groups, and `WFRD` for
Bus Éireann Waterford. The second segment is the `route_short_name`.

`trip_id` remained in `<prefix>_<number>` form, but those prefixes changed too
(for example, Go-Ahead `5576_713`). The schedule DBs therefore also needed to be
regenerated and re-uploaded to the Fly volume.

Realtime `Vehicles` and `TripUpdates` switched to the new encoding at the same
time. Unlike the 2026-04-23 Bus Éireann-only prefix roll, this was a simultaneous
static and realtime schema change across all three operators.

## NTA Declared Publish Dates From `feed_info.txt`

| observed date | `feed_start_date` | `feed_version` UUID                    | since previous |
|---------------|-------------------|----------------------------------------|----------------|
| 2026-04-14    | 20260414          | `362FED45-B5F1-4D6C-B51B-906922AC6AF0` | -              |
| 2026-04-23    | 20260423          | `49433242-3F07-4245-8C25-460F0EE6851E` | 9 days         |
| 2026-04-25    | 20260425          | `3F733077-EF7E-4C1B-84F4-1BF3AA9FF788` | 2 days         |
| 2026-04-27    | 20260427          | `1B949A1D-9DDF-48B6-9217-D91D48FD8D04` | 2 days         |
| 2026-04-29    | 20260429          | `E3B0A11B-0BF2-43A9-A25A-5D64C5A79BAC` | 2 days         |
| 2026-04-30    | 20260430          | `7255571F-A5F5-4507-BC91-D0384F6935CD` | 1 day          |
| 2026-05-01    | 20260501          | `3035A46D-8FA6-419D-A378-D17A033B154F` | 1 day          |
| 2026-05-02    | 20260502          | `0839437A-650C-4D86-B368-2AEBE0B60DBF` | 1 day          |
| 2026-05-03    | 20260503          | `FA3F92F8-B7BE-44ED-AEEF-6712BE80E03B` | 1 day          |
| 2026-05-07    | 20260507          | `CE1ED411-4C10-4C2A-864C-15248C162CB1` | 4 days         |
| 2026-05-11    | 20260511          | `110F282B-11F2-40BE-ACF7-379FCA2A45F6` | 4 days         |

Notes:

- The 2026-05-01, 2026-05-02, and 2026-05-03 rows were read from the lightweight
  `feed_info.txt` endpoint.
- `3035A46D` eventually entered the zip and closed the mode D loop.
- `0839437A` never entered a zip. NTA skipped that full zip version and moved
  directly to `FA3F92F8`.
- Mode D does not always close by uploading the same UUID later; it can also
  close by skipping to the next UUID.

Each publish uses a new UUID, and `feed_end_date` is consistently one year after
`feed_start_date`. The observed 9-day and 2-day intervals were enough to reject a
simple weekly-release assumption. NTA republishes irregularly, and prefixes do
not roll every time.

## Stable Agency Prefixes

Across the 12-day window from 2026-04-14 to 2026-04-26, these prefixes were
stable and useful as controls:

- Dublin Bus `5570`: unchanged for 12 days.
- Go-Ahead `5398` and `5576`: unchanged for 12 days.
- Bus Éireann `5502`, the standalone Limerick 310 route: unchanged for 12 days.
- On the 2026-04-25 reissue, all seven agency prefixes were unchanged, including
  the Bus Éireann `5578` prefix that had just rolled.

## Quick Drift Check

Compare local static JSON prefixes with live Vehicles feed prefixes. A mismatch
usually means NTA rolled or rewrote IDs.

```bash
# 1. Prefixes currently known by local JSON.
for op in buseireann dublinbus goahead; do
  echo "-- $op --"
  jq -r '[.[] | .id | split("_")[0]] | unique | .[]' "src/data/${op}-routes.json"
done

# 2. Prefixes currently used by the live Vehicles feed.
set -a; source .env; set +a
curl -s -H "x-api-key: $NTA_API_KEY" \
  "https://api.nationaltransport.ie/gtfsr/v2/Vehicles?format=json" \
  | jq -r '[.entity[] | .vehicle.trip.route_id // empty | split("_")[0]] | group_by(.) | map({prefix: .[0], count: length}) | .[] | "\(.prefix): \(.count)"'
```

If the two sides disagree, regenerate the derived data.

## What To Record Next Time Drift Appears

1. The affected agency.
2. Old prefix -> new prefix.
3. NTA's declared `feed_start_date` and `feed_end_date` from `feed_info.txt`.
4. The number of days since the previous publish.

After several observations, the release cadence and drift patterns become easier
to identify.
