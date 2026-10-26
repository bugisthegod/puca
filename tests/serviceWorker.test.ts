import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

const worker = runInNewContext(
	`${await Bun.file("public/sw.js").text()}
	({ isTileRequest, PRECACHE_URLS });`,
	{ self: { addEventListener() {} } },
) as {
	isTileRequest: (url: URL) => boolean;
	PRECACHE_URLS: string[];
};

test("updates precache the campaign tickets without downloading every iPhone splash", () => {
	expect(worker.PRECACHE_URLS.some((url) => url.startsWith("/splash/"))).toBe(
		false,
	);
	for (const locale of ["zh", "en"]) {
		expect(worker.PRECACHE_URLS).toContain(
			`/halloween-notice-${locale}.webp?v=oct26-1`,
		);
	}
});

test("tile caching accepts the current CARTO path and the previous rastertiles path", () => {
	for (const path of [
		"/dark_all/13/3950/2700.png",
		"/dark_all/13/3950/2700@2x.png",
		"/rastertiles/dark_all/13/3950/2700.png",
		"/rastertiles/voyager/13/3950/2700@2x.png",
	]) {
		expect(
			worker.isTileRequest(new URL(`https://a.basemaps.cartocdn.com${path}`)),
		).toBe(true);
	}
	expect(
		worker.isTileRequest(
			new URL("https://tiles.openrailwaymap.org/standard/13/3950/2700.png"),
		),
	).toBe(true);
});

test("tile caching still excludes keyed requests, other hosts and invalid zooms", () => {
	for (const url of [
		"https://a.basemaps.cartocdn.com/dark_all/13/3950/2700.png?key=example",
		"https://example.com/dark_all/13/3950/2700.png",
		"https://a.basemaps.cartocdn.com/dark_all/21/3950/2700.png",
	]) {
		expect(worker.isTileRequest(new URL(url))).toBe(false);
	}
});
