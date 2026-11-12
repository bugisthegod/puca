import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

async function fixture(separator: string) {
	const root = mkdtempSync(join(tmpdir(), "puca-feed-"));
	roots.push(root);
	for (const directory of ["gtfs", ".github/data", "src/data"])
		mkdirSync(join(root, directory), { recursive: true });
	const marker = "feed_version\nfeed-v1\n";
	await Bun.write(join(root, ".github/data/feed_info.txt"), marker);
	await Bun.write(join(root, "gtfs/feed_info.txt"), marker);
	for (const name of ["trips.txt", "stop_times.txt", "shapes.txt", "stops.txt"])
		await Bun.write(join(root, `gtfs/${name}`), "");
	const routes = [
		["dublinbus", "1", "38A"],
		["buseireann", "2", "100"],
		["buseireann", "WFRD", "W1"],
		["goahead", "3", "18"],
		["goahead", "03C", "120"],
	] as const;
	await Bun.write(
		join(root, "gtfs/routes.txt"),
		`agency_id,route_id\n${routes.map(([, agency, name]) => `${agency},${[agency, name, "a"].join(separator)}`).join("\n")}\n`,
	);
	for (const operator of ["dublinbus", "buseireann", "goahead"])
		await Bun.write(
			join(root, `src/data/${operator}-routes.json`),
			JSON.stringify(
				routes
					.filter(([value]) => value === operator)
					.map(([, agency, name]) => ({
						id: [agency, name, "a"].join(separator),
					})),
			),
		);
	return root;
}

function verify(root: string) {
	return Bun.spawnSync([
		"python3",
		"-B",
		"-c",
		"from pathlib import Path; import sys; from scripts.verify_schedule_feed import verify_feed; verify_feed(Path(sys.argv[1]))",
		root,
	]);
}

test("schedule verification accepts matching feeds with spaces or underscores", async () => {
	for (const separator of [" ", "_"])
		expect(verify(await fixture(separator)).exitCode).toBe(0);
});

test("schedule verification rejects a newer feed before production changes", async () => {
	const root = await fixture("_");
	await Bun.write(join(root, "gtfs/feed_info.txt"), "feed_version\nfeed-v2\n");
	const result = verify(root);
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.toString()).toContain("does not match app version");
});

test("schedule verification rejects mismatched route IDs despite a matching marker", async () => {
	const root = await fixture("_");
	await Bun.write(
		join(root, "src/data/dublinbus-routes.json"),
		JSON.stringify([{ id: "1 38A a" }]),
	);
	const result = verify(root);
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.toString()).toContain("app route IDs do not match");
});

test("schedule verification rejects an incomplete GTFS archive", async () => {
	const root = await fixture("_");
	rmSync(join(root, "gtfs/trips.txt"));
	const result = verify(root);
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.toString()).toContain("Missing GTFS files: trips.txt");
});

function artifactCommand(root: string, command: string, extra: string[] = []) {
	return Bun.spawnSync([
		"python3",
		"-B",
		new URL("../scripts/schedule_artifacts.py", import.meta.url).pathname,
		command,
		"--root",
		root,
		"--directory",
		join(root, "bundle"),
		...extra,
	]);
}

async function artifactFixture() {
	const root = await fixture("_");
	mkdirSync(join(root, "scripts"));
	for (const name of [
		"gen_bus_schedule_sqlite.py",
		"gen_buseireann_schedule.py",
		"gen_goahead_schedule.py",
	])
		await Bun.write(join(root, "scripts", name), "# generator v1\n");
	for (const name of [
		"bus-schedule.db",
		"buseireann-schedule.db",
		"goahead-schedule.db",
	]) {
		const db = new Database(join(root, "src/data", name));
		db.run("CREATE TABLE stop_times (arrival_sec INTEGER)");
		db.run("INSERT INTO stop_times VALUES (120)");
		db.close();
	}
	return root;
}

test("feed metadata comparison handles quoted CSV fields and unchanged versions", async () => {
	const root = await fixture("_");
	const csv =
		'feed_publisher_name,feed_start_date,feed_version,feed_end_date\n"Name, with comma",20261111,feed-v1,20271111\n';
	await Bun.write(join(root, "gtfs/feed_info.txt"), csv);
	await Bun.write(join(root, ".github/data/feed_info.txt"), csv);
	const result = artifactCommand(root, "compare");
	expect(result.exitCode).toBe(0);
	expect(result.stdout.toString()).toContain("uuid=feed-v1\n");
	expect(result.stdout.toString()).toContain("changed=false\n");
});

test("verified schedule bundle restores matching databases", async () => {
	const root = await artifactFixture();
	const packed = artifactCommand(root, "pack");
	expect(packed.exitCode, packed.stderr.toString()).toBe(0);
	rmSync(join(root, "src/data/bus-schedule.db"));
	expect(artifactCommand(root, "restore").exitCode).toBe(0);
	const db = new Database(join(root, "src/data/bus-schedule.db"));
	expect(db.query("SELECT COUNT(*) AS count FROM stop_times").get()).toEqual({
		count: 1,
	});
	db.close();
});

test("schedule bundle rejects changed app inputs and changes artifact identity", async () => {
	const root = await artifactFixture();
	const packed = artifactCommand(root, "pack");
	expect(packed.exitCode, packed.stderr.toString()).toBe(0);
	const before = artifactCommand(root, "name").stdout.toString();
	await Bun.write(join(root, "src/data/dublinbus-routes.json"), "[]");
	expect(artifactCommand(root, "name").stdout.toString()).not.toBe(before);
	const result = artifactCommand(root, "restore");
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.toString()).toContain(
		"does not match app data/generators",
	);
});

test("schedule generator changes invalidate previously checked DBs", async () => {
	const root = await artifactFixture();
	const packed = artifactCommand(root, "pack");
	expect(packed.exitCode, packed.stderr.toString()).toBe(0);
	await Bun.write(
		join(root, "scripts/gen_bus_schedule_sqlite.py"),
		"# new schema\n",
	);
	expect(artifactCommand(root, "restore").exitCode).not.toBe(0);
});

test("schedule bundle verifies all checksums before replacing local DBs", async () => {
	const root = await artifactFixture();
	const packed = artifactCommand(root, "pack");
	expect(packed.exitCode, packed.stderr.toString()).toBe(0);
	const before = await Bun.file(join(root, "src/data/bus-schedule.db")).bytes();
	await Bun.write(join(root, "bundle/goahead-schedule.db"), "partial upload");
	const result = artifactCommand(root, "restore");
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.toString()).toContain("checksum mismatch");
	expect(
		await Bun.file(join(root, "src/data/bus-schedule.db")).bytes(),
	).toEqual(before);
});

test("schedule bundles reject empty databases before archiving", async () => {
	const root = await artifactFixture();
	const db = new Database(join(root, "src/data/bus-schedule.db"));
	db.run("DELETE FROM stop_times");
	db.close();
	expect(artifactCommand(root, "pack").exitCode).not.toBe(0);
});

test("code-only deploys skip DB replacement but retry failed data deploys", async () => {
	const root = await fixture("_");
	function git(...args: string[]) {
		const result = Bun.spawnSync(
			[
				"git",
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.com",
				...args,
			],
			{ cwd: root },
		);
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
		return result.stdout.toString().trim();
	}
	git("init");
	git("add", ".");
	git("commit", "-m", "Deployed data");
	const deployed = git("rev-parse", "HEAD");
	await Bun.write(join(root, "README.md"), "Code-only change\n");
	git("add", ".");
	git("commit", "-m", "Code only");
	expect(
		artifactCommand(root, "changed", ["--base", deployed]).stdout.toString(),
	).toBe("false\n");
	await Bun.write(
		join(root, ".github/data/feed_info.txt"),
		"feed_version\nv2\n",
	);
	git("add", ".");
	git("commit", "-m", "Data update whose deploy failed");
	const failed = git("rev-parse", "HEAD");
	await Bun.write(join(root, "README.md"), "Next code-only change\n");
	git("add", ".");
	git("commit", "-m", "Later code");
	expect(
		artifactCommand(root, "changed", ["--base", failed]).stdout.toString(),
	).toBe("false\n");
	expect(
		artifactCommand(root, "changed", ["--base", deployed]).stdout.toString(),
	).toBe("true\n");
});
