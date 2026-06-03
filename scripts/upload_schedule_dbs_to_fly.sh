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

log "Replacing schedule DBs on Fly app: $APP"
log "Schedule lookups may fail until upload finishes."
log "Local DB sizes"
for db in "${DBS[@]}"; do
	ls -lh "src/data/$db"
done

log "Checking Fly app access"
"$FLY_BIN" status -a "$APP" >/dev/null

remote_files=()
for db in "${DBS[@]}"; do
	remote_files+=("$DATA_DIR/$db" "$DATA_DIR/$db.new")
done

log "Deleting live schedule DBs and leftover .new files"
printf -v remote_rm_args ' "%s"' "${remote_files[@]}"
"$FLY_BIN" ssh console -a "$APP" --command "rm -f$remote_rm_args"

log "Restarting Fly app to release deleted SQLite file handles"
"$FLY_BIN" apps restart "$APP"

log "Remote /data free space after delete"
"$FLY_BIN" ssh console -a "$APP" --command "sh -c 'df -h \"$DATA_DIR\" && ls -lh \"$DATA_DIR\"'"

total_bytes=0
for db in "${DBS[@]}"; do
	local_bytes=$(wc -c < "src/data/$db" | tr -d ' ')
	total_bytes=$(( total_bytes + local_bytes ))
done

available_kb=$(
	"$FLY_BIN" ssh console -a "$APP" --command "sh -c 'df -Pk \"$DATA_DIR\" | awk \"NR==2 {print \\\$4}\"'"
)
available_bytes=$(( available_kb * 1024 ))

if (( available_bytes < total_bytes )); then
	printf 'Not enough free space on %s for DB upload: need %s bytes, have %s bytes\n' \
		"$DATA_DIR" "$total_bytes" "$available_bytes" >&2
	exit 1
fi

log "Uploading replacement DBs"
for db in "${DBS[@]}"; do
	local_path="src/data/$db"
	remote_path="$DATA_DIR/$db"
	size_mb=$(du -m "$local_path" | cut -f1)
	local_bytes=$(wc -c < "$local_path" | tr -d ' ')

	log "Uploading $db ($size_mb MB) to $remote_path"
	"$FLY_BIN" sftp put "$local_path" "$remote_path" -a "$APP"

	log "Checking uploaded size for $db"
	"$FLY_BIN" ssh console -a "$APP" --command "sh -c 'test \"\$(stat -c%s \"$remote_path\")\" = \"$local_bytes\"'"
done

log "Restarting Fly app once after DB upload"
"$FLY_BIN" apps restart "$APP"

log "Remote /data after upload"
"$FLY_BIN" ssh console -a "$APP" --command "sh -c 'df -h \"$DATA_DIR\" && ls -lh \"$DATA_DIR\"'"

log "Done"
