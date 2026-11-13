import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

async function runUpload(state = "stopped", failure = "", count = 1) {
	const root = mkdtempSync(join(tmpdir(), "puca-upload-"));
	roots.push(root);
	mkdirSync(join(root, "src/data"), { recursive: true });
	for (const name of ["bus", "buseireann", "goahead"])
		await Bun.write(join(root, `src/data/${name}-schedule.db`), "fixture");
	const machine = {
		id: "volume-owner",
		state,
		config: {
			metadata: { fly_process_group: "app" },
			mounts: [{ path: "/data", volume: "vol_test" }],
		},
	};
	const machines = Array.from({ length: count }, (_, i) => ({
		...machine,
		id: i ? `other-${i}` : machine.id,
	}));
	const fly = join(root, "fly");
	await Bun.write(join(root, "state"), state);
	await Bun.write(join(root, "phase"), "0");
	await Bun.write(
		fly,
		`#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$CALLS"
case "$1 $2" in
  'machine list') printf '%s\\n' "$MACHINES" ;;
  'machine start')
    [ "$FAILURE" != start ] || exit 1
    printf started > "$STATE"
    ;;
  'machine wait')
    [ "$FAILURE" != wait ] || exit 1
    state=$(cat "$STATE")
    if [ "$state" = starting ]; then printf started > "$STATE"; fi
    [ "$(cat "$STATE")" = started ] || exit 1
    ;;
  'machine restart')
    printf started > "$STATE"
    printf '%s' "$(( $(cat "$PHASE") + 1 ))" > "$PHASE"
    ;;
  'ssh console')
    [[ "$*" == *'--machine volume-owner'* ]] || exit 90
    [ "$(cat "$STATE")" = started ] || { echo 'no started VMs' >&2; exit 1; }
    phase=$(cat "$PHASE")
    if [[ "$*" == *'--command true' ]]; then
      [ "$FAILURE" != ssh ] || exit 1
      if [ "$FAILURE" = transient ] && [ ! -f "$ONCE.$phase" ]; then
        touch "$ONCE.$phase"
        exit 1
      fi
      touch "$READY.$phase"
    else
      [ -f "$READY.$phase" ] || exit 91
    fi
    if [[ "$*" == *'df -Pk'* ]]; then printf '1000000\\n'; fi
    ;;
  'sftp put') [[ "$*" == *'--machine volume-owner'* ]] ;;
esac
`,
	);
	await Bun.write(join(root, "sleep"), "#!/bin/bash\nexit 0\n");
	for (const path of [fly, join(root, "sleep")]) chmodSync(path, 0o755);
	const proc = Bun.spawn(
		[
			"bash",
			new URL("../scripts/upload_schedule_dbs_to_fly.sh", import.meta.url)
				.pathname,
		],
		{
			cwd: root,
			env: {
				...process.env,
				FLY: fly,
				PATH: `${root}:${process.env.PATH}`,
				CALLS: join(root, "calls"),
				ONCE: join(root, "once"),
				STATE: join(root, "state"),
				PHASE: join(root, "phase"),
				READY: join(root, "ready"),
				MACHINES: JSON.stringify(machines),
				FAILURE: failure,
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [code, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return {
		code,
		stdout,
		stderr,
		calls: await Bun.file(join(root, "calls")).text(),
	};
}

test("starts a stopped volume owner and waits before deletion and after restarts", async () => {
	const result = await runUpload();
	expect(result.code).toBe(0);
	const calls = result.calls.split("\n");
	const start = calls.findIndex((call) => call.startsWith("machine start"));
	const ready = calls.findIndex((call) => call.endsWith("--command true"));
	const deletion = calls.findIndex((call) => call.includes("--command rm -f"));
	expect(start).toBeGreaterThan(-1);
	expect(ready).toBeGreaterThan(start);
	expect(deletion).toBeGreaterThan(ready);
	expect(calls.filter((call) => call.startsWith("sftp put"))).toHaveLength(3);
	expect(
		calls.filter((call) => call.startsWith("machine restart")),
	).toHaveLength(2);
	expect(calls.filter((call) => call.startsWith("machine wait"))).toHaveLength(
		3,
	);
	expect(result.calls).not.toContain("apps restart");
});

test("already running machines need no start and transient SSH failure is retried", async () => {
	const result = await runUpload("started", "transient");
	expect(result.code).toBe(0);
	expect(result.calls).not.toContain("machine start ");
	expect(result.calls.match(/--command true/g)).toHaveLength(6);
});

for (const state of ["suspended", "created", "starting"]) {
	test(`completes replacement when machine is initially ${state}`, async () => {
		const result = await runUpload(state);
		expect(result.code).toBe(0);
		expect(result.calls.match(/sftp put/g)).toHaveLength(3);
	});
}

for (const failure of ["start", "wait", "ssh"]) {
	test(`failure during ${failure} leaves old DBs untouched`, async () => {
		const result = await runUpload("stopped", failure);
		expect(result.code).not.toBe(0);
		expect(result.calls).not.toContain("--command rm -f");
		expect(result.calls).not.toContain("sftp put");
	});
}

for (const count of [0, 2]) {
	test(`refuses ambiguous or missing volume owner (${count})`, async () => {
		const result = await runUpload("started", "", count);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Expected one app machine");
		expect(result.calls).not.toContain("ssh console");
	});
}
