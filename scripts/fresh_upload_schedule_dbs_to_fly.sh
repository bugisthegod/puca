#!/usr/bin/env bash
set -euo pipefail

APP="${APP:-puca}"
DATA_DIR="${DATA_DIR:-/data}"
FLY_BIN="${FLY:-}"

DBS=(
	"bus-schedule.db"
	"buseireann-schedule.db"
	"goahead-schedule.db"
)

log() {
	printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

if [[ -z "$FLY_BIN" ]]; then
	if command -v fly >/dev/null 2>&1; then
		FLY_BIN="fly"
	elif command -v flyctl >/dev/null 2>&1; then
		FLY_BIN="flyctl"
	fi
fi

if [[ -z "$FLY_BIN" ]]; then
	printf 'Missing required command: fly or flyctl\n' >&2
	exit 1
fi

for db in "${DBS[@]}"; do
	path="src/data/$db"
	if [[ ! -f "$path" ]]; then
		printf 'Missing local DB: %s\n' "$path" >&2
		exit 1
	fi
done

log "Deleting live schedule DBs from Fly app: $APP"
log "Schedule lookups may fail until upload finishes."

remote_files=()
for db in "${DBS[@]}"; do
	remote_files+=("$DATA_DIR/$db" "$DATA_DIR/$db.new")
done

printf -v remote_rm_args ' "%s"' "${remote_files[@]}"
"$FLY_BIN" ssh console -a "$APP" --command "rm -f$remote_rm_args"

log "Restarting Fly app to release deleted SQLite file handles"
"$FLY_BIN" apps restart "$APP"

log "Remote /data free space after delete"
"$FLY_BIN" ssh console -a "$APP" --command "sh -c 'df -h \"$DATA_DIR\" && ls -lh \"$DATA_DIR\"'"

log "Uploading replacement DBs"
FLY="$FLY_BIN" APP="$APP" DATA_DIR="$DATA_DIR" bash scripts/upload_schedule_dbs_to_fly.sh
