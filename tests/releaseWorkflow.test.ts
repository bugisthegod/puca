import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});
const workflow = Bun.YAML.parse(
	await Bun.file(
		new URL("../.github/workflows/fly-deploy.yml", import.meta.url),
	).text(),
) as { jobs: { deploy: { steps: Array<{ id?: string; run?: string }> } } };
const decision = workflow.jobs.deploy.steps.find(
	(step) => step.id === "schedules",
)?.run;
if (!decision) throw new Error("Missing release decision step");

async function fixture() {
	const root = mkdtempSync(join(tmpdir(), "puca-release-"));
	roots.push(root);
	for (const path of ["scripts", ".github/data", "bin"])
		mkdirSync(join(root, path), { recursive: true });
	for (const name of ["schedule_artifacts.py", "verify_schedule_feed.py"])
		await Bun.write(
			join(root, "scripts", name),
			Bun.file(new URL(`../scripts/${name}`, import.meta.url)),
		);
	const realGit = Bun.which("git");
	if (!realGit) throw new Error("Git required");
	function git(...args: string[]) {
		const result = Bun.spawnSync(
			[
				realGit!,
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.com",
				...args,
			],
			{ cwd: root },
		);
		if (result.exitCode) throw new Error(result.stderr.toString());
		return result.stdout.toString().trim();
	}
	git("init");
	await Bun.write(
		join(root, ".github/data/feed_info.txt"),
		"feed_version\nv1\n",
	);
	git("add", ".");
	git("commit", "-m", "Successful release");
	const base = git("rev-parse", "HEAD");
	await Bun.write(
		join(root, ".github/data/feed_info.txt"),
		"feed_version\nv2\n",
	);
	git("add", ".");
	git("commit", "-m", "Failed data release");
	const data = git("rev-parse", "HEAD");
	await Bun.write(join(root, "README.md"), "Later code update\n");
	git("add", ".");
	git("commit", "-m", "Code update");
	const head = git("rev-parse", "HEAD");
	await Bun.write(
		join(root, "bin/git"),
		'#!/bin/bash\nif [ "$1" = ls-remote ]; then printf "%s\\trefs/heads/main\\n" "$MOCK_MAIN"; else exec "$REAL_GIT" "$@"; fi\n',
	);
	await Bun.write(
		join(root, "bin/gh"),
		'#!/bin/bash\nif [ "$1 $2" != "run list" ]; then exit 2; fi\nprintf "%s\\n" "$MOCK_BASE"\n',
	);
	for (const name of ["git", "gh"]) chmodSync(join(root, "bin", name), 0o755);
	async function run(overrides: Record<string, string> = {}) {
		const output = join(root, "output");
		await Bun.write(output, "");
		const result = Bun.spawnSync(
			["bash", "-e", "-o", "pipefail", "-c", decision!],
			{
				cwd: root,
				env: {
					...process.env,
					PATH: `${join(root, "bin")}:${process.env.PATH}`,
					REAL_GIT: realGit!,
					GITHUB_OUTPUT: output,
					GITHUB_SHA: head,
					BEFORE: data,
					FORCE: "false",
					GH_REPO: "test/puca",
					MOCK_MAIN: head,
					MOCK_BASE: base,
					...overrides,
				},
			},
		);
		return { ...result, output: await Bun.file(output).text() };
	}
	return { run, base, data, head };
}

test("release shell retries data after a failed deployment and a later code push", async () => {
	const { run } = await fixture();
	const result = await run();
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	expect(result.output).toContain("changed=true");
});

test("release shell skips DB work when data was already successfully deployed", async () => {
	const { run, data } = await fixture();
	const result = await run({ MOCK_BASE: data });
	expect(result.exitCode).toBe(0);
	expect(result.output).toContain("changed=false");
});

test("manual repair forces DB restoration even without a data diff", async () => {
	const { run, head } = await fixture();
	const result = await run({ MOCK_BASE: head, FORCE: "true" });
	expect(result.exitCode).toBe(0);
	expect(result.output).toContain("changed=true");
});

test("superseded release cannot overwrite production or be recorded as successful", async () => {
	const { run, base } = await fixture();
	const result = await run({ MOCK_MAIN: base });
	expect(result.exitCode).not.toBe(0);
	expect(result.output).not.toContain("current=true");
});

test("missing deployment history requires verified DBs despite a code-only previous push", async () => {
	const { run, data } = await fixture();
	const result = await run({ MOCK_BASE: "", BEFORE: data });
	expect(result.exitCode).toBe(0);
	expect(result.output).toContain("changed=true");
});
