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

log "Uploading schedule DBs to Fly app: $APP"
log "Local DB sizes"
for db in "${DBS[@]}"; do
	ls -lh "src/data/$db"
done

log "Checking Fly app access"
"$FLY_BIN" status -a "$APP" >/dev/null

log "Remote /data free space"
"$FLY_BIN" ssh console -a "$APP" --command "sh -c 'df -h \"$DATA_DIR\" && ls -lh \"$DATA_DIR\"'"

for db in "${DBS[@]}"; do
	local_path="src/data/$db"
	remote_path="$DATA_DIR/$db"
	remote_tmp="$remote_path.new"
	size_mb=$(du -m "$local_path" | cut -f1)
	local_bytes=$(wc -c < "$local_path" | tr -d ' ')
	available_kb=$(
		"$FLY_BIN" ssh console -a "$APP" --command "sh -c 'df -Pk \"$DATA_DIR\" | awk \"NR==2 {print \\\$4}\"'"
	)
	available_bytes=$(( available_kb * 1024 ))

	if (( available_bytes < local_bytes )); then
		printf 'Not enough free space on %s for %s.new: need %s bytes, have %s bytes\n' \
			"$DATA_DIR" "$db" "$local_bytes" "$available_bytes" >&2
		exit 1
	fi

	log "Uploading $db ($size_mb MB) to $remote_tmp"
	start_sec=$(date +%s)
	"$FLY_BIN" sftp put "$local_path" "$remote_tmp" -a "$APP"
	elapsed=$(( $(date +%s) - start_sec ))

	log "Checking uploaded size for $db"
	"$FLY_BIN" ssh console -a "$APP" --command "sh -c 'test \"\$(stat -c%s \"$remote_tmp\")\" = \"$local_bytes\"'"

	log "Uploaded $db in ${elapsed}s, replacing $remote_path"
	"$FLY_BIN" ssh console -a "$APP" --command "sh -c 'mv \"$remote_tmp\" \"$remote_path\"'"
	log "Replaced $remote_path"

	log "Restarting Fly app to release old $db file handles"
	"$FLY_BIN" apps restart "$APP"
done

log "Done"
