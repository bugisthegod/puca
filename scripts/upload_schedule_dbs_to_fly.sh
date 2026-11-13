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

wait_for_ssh() {
	local attempt
	"$FLY_BIN" machine wait "$MACHINE_ID" -a "$APP" --state started --wait-timeout 60s
	for (( attempt = 1; attempt <= 12; attempt++ )); do
		if "$FLY_BIN" ssh console -a "$APP" --machine "$MACHINE_ID" --command true; then
			return 0
		fi
		if (( attempt < 12 )); then sleep 5; fi
	done
	printf 'Machine %s did not become SSH-ready; inspect its startup logs before retrying.\n' "$MACHINE_ID" >&2
	"$FLY_BIN" machine status "$MACHINE_ID" -a "$APP" >&2 || true
	return 1
}

upload_with_retry() {
	local local_path="$1"
	local remote_path="$2"
	local attempts="${SFTP_UPLOAD_ATTEMPTS:-3}"
	local attempt

	for (( attempt = 1; attempt <= attempts; attempt++ )); do
		if (( attempt > 1 )); then
			log "Retrying upload ($attempt/$attempts): $local_path"
		fi

		if "$FLY_BIN" sftp put "$local_path" "$remote_path" -a "$APP" --machine "$MACHINE_ID"; then
			return 0
		fi

		if (( attempt == attempts )); then
			break
		fi

		log "Upload failed; waiting 10s before retry"
		sleep 10
	done

	printf 'Upload failed after %s attempts: %s -> %s\n' \
		"$attempts" "$local_path" "$remote_path" >&2
	return 1
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

# This replacement flow supports one schedule volume. Never pick an arbitrary
# running VM: SSH, SFTP and restarts must all operate on the same volume owner.
machine=$(
	"$FLY_BIN" machine list -a "$APP" --json | bun -e '
		const machines = JSON.parse(await Bun.stdin.text());
		const candidates = machines.filter(m =>
			m.state !== "destroyed" &&
			m.config?.metadata?.fly_process_group === "app" &&
			m.config?.mounts?.some(mount => mount.path === process.argv[1])
		);
		if (candidates.length !== 1) {
			console.error(`Expected one app machine mounting ${process.argv[1]}, found ${candidates.length}; refusing DB replacement.`);
			process.exit(1);
		}
		console.log(`${candidates[0].id} ${candidates[0].state}`);
	' "$DATA_DIR"
)
read -r MACHINE_ID machine_state <<< "$machine"
log "Preparing schedule volume machine: $MACHINE_ID ($machine_state)"
case "$machine_state" in
	stopped|suspended|created)
		"$FLY_BIN" machine start "$MACHINE_ID" -a "$APP"
		;;
esac
wait_for_ssh

remote_files=()
for db in "${DBS[@]}"; do
	remote_files+=("$DATA_DIR/$db" "$DATA_DIR/$db.new")
done

log "Deleting live schedule DBs and leftover .new files"
printf -v remote_rm_args ' "%s"' "${remote_files[@]}"
"$FLY_BIN" ssh console -a "$APP" --machine "$MACHINE_ID" --command "rm -f$remote_rm_args"

log "Restarting Fly app to release deleted SQLite file handles"
"$FLY_BIN" machine restart "$MACHINE_ID" -a "$APP"
wait_for_ssh

log "Remote /data free space after delete"
"$FLY_BIN" ssh console -a "$APP" --machine "$MACHINE_ID" --command "sh -c 'df -h \"$DATA_DIR\" && ls -lh \"$DATA_DIR\"'"

total_bytes=0
for db in "${DBS[@]}"; do
	local_bytes=$(wc -c < "src/data/$db" | tr -d ' ')
	total_bytes=$(( total_bytes + local_bytes ))
done

available_kb=$(
	"$FLY_BIN" ssh console -a "$APP" --machine "$MACHINE_ID" --command "sh -c 'df -Pk \"$DATA_DIR\" | awk \"NR==2 {print \\\$4}\"'"
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
	upload_with_retry "$local_path" "$remote_path"

	log "Checking uploaded size for $db"
	"$FLY_BIN" ssh console -a "$APP" --machine "$MACHINE_ID" --command "sh -c 'test \"\$(stat -c%s \"$remote_path\")\" = \"$local_bytes\"'"
done

log "Restarting Fly app once after DB upload"
"$FLY_BIN" machine restart "$MACHINE_ID" -a "$APP"
wait_for_ssh

log "Remote /data after upload"
"$FLY_BIN" ssh console -a "$APP" --machine "$MACHINE_ID" --command "sh -c 'df -h \"$DATA_DIR\" && ls -lh \"$DATA_DIR\"'"

log "Done"
