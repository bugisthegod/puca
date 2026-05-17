#!/usr/bin/env bash
set -euo pipefail

APP="${APP:-puca}"
DATA_DIR="${DATA_DIR:-/data}"

DBS=(
	"bus-schedule.db"
	"buseireann-schedule.db"
	"goahead-schedule.db"
)

log() {
	printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf 'Missing required command: %s\n' "$1" >&2
		exit 1
	fi
}

require_command fly

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
fly status -a "$APP" >/dev/null

log "Remote /data free space"
fly ssh console -a "$APP" --command "sh -c 'df -h \"$DATA_DIR\" && ls -lh \"$DATA_DIR\"'"

for db in "${DBS[@]}"; do
	local_path="src/data/$db"
	remote_path="$DATA_DIR/$db"
	remote_tmp="$remote_path.new"
	size_mb=$(du -m "$local_path" | cut -f1)

	log "Uploading $db ($size_mb MB) to $remote_tmp"
	start_sec=$(date +%s)
	fly sftp put "$local_path" "$remote_tmp" -a "$APP"
	elapsed=$(( $(date +%s) - start_sec ))

	log "Uploaded $db in ${elapsed}s, replacing $remote_path"
	fly ssh console -a "$APP" --command "sh -c 'mv \"$remote_tmp\" \"$remote_path\"'"
	log "Replaced $remote_path"
done

log "Restarting Fly app"
fly apps restart "$APP"

log "Done"
