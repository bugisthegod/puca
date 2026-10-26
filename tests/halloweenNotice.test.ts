import { expect, setSystemTime, test } from "bun:test";
import {
	canOpenHalloweenNotice,
	isHalloweenEventActive,
	markHalloweenNoticeSeen,
	shouldShowHalloweenNotice,
	watchHalloweenNotice,
} from "../src/client/components/HalloweenNotice";

test("Halloween announcement runs Oct 26–31 in Dublin", () => {
	expect(isHalloweenEventActive(new Date("2026-10-25T23:59:59Z"))).toBe(false);
	expect(isHalloweenEventActive(new Date("2026-10-26T00:00:00Z"))).toBe(true);
	expect(isHalloweenEventActive(new Date("2026-10-31T23:59:59Z"))).toBe(true);
	expect(isHalloweenEventActive(new Date("2026-11-01T00:00:00Z"))).toBe(false);
});

test("a PWA opened before launch announces on resume, then stays quiet after dismissal", () => {
	const originalDocument = Object.getOwnPropertyDescriptor(
		globalThis,
		"document",
	);
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const originalStorage = globalThis.localStorage;
	const doc = Object.assign(new EventTarget(), { hidden: false });
	const win = new EventTarget();
	let seen: string | null = null;
	let announcements = 0;
	let cleanup = () => {};
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: doc,
	});
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: win,
	});
	globalThis.localStorage = {
		getItem: () => seen,
		setItem: (_key: string, value: string) => {
			seen = value;
		},
	} as unknown as Storage;
	try {
		setSystemTime(new Date("2026-10-25T23:50:00Z"));
		cleanup = watchHalloweenNotice(() => announcements++);
		expect(announcements).toBe(0);
		doc.hidden = true;
		setSystemTime(new Date("2026-10-26T08:00:00Z"));
		doc.dispatchEvent(new Event("visibilitychange"));
		expect(announcements).toBe(0);
		doc.hidden = false;
		doc.dispatchEvent(new Event("visibilitychange"));
		expect(announcements).toBe(1);
		markHalloweenNoticeSeen();
		win.dispatchEvent(new Event("pageshow"));
		doc.dispatchEvent(new Event("visibilitychange"));
		expect(announcements).toBe(1);
		seen = null;
		cleanup();
		win.dispatchEvent(new Event("pageshow"));
		doc.dispatchEvent(new Event("visibilitychange"));
		expect(announcements).toBe(1);
	} finally {
		cleanup();
		setSystemTime();
		globalThis.localStorage = originalStorage;
		if (originalDocument)
			Object.defineProperty(globalThis, "document", originalDocument);
		else Reflect.deleteProperty(globalThis, "document");
		if (originalWindow)
			Object.defineProperty(globalThis, "window", originalWindow);
		else Reflect.deleteProperty(globalThis, "window");
	}
});

test("both ticket languages are precached at the exact URL used by the dialog", async () => {
	const worker = await Bun.file("public/sw.js").text();
	for (const locale of ["zh", "en"]) {
		expect(worker).toContain(`"/halloween-notice-${locale}.webp?v=oct26-1"`);
		expect(
			await Bun.file(`public/halloween-notice-${locale}.webp`).exists(),
		).toBe(true);
	}
});

test("About allows a preview today without activating the campaign", () => {
	const today = new Date("2026-10-25T12:00:00Z");
	expect(canOpenHalloweenNotice(today)).toBe(true);
	expect(isHalloweenEventActive(today)).toBe(false);
	expect(canOpenHalloweenNotice(new Date("2026-11-01T00:00:00Z"))).toBe(false);
});

test("campaign appears once per browser, and an early preview does not consume it", () => {
	const originalStorage = globalThis.localStorage;
	const values = new Map<string, string>();
	globalThis.localStorage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	} as unknown as Storage;
	try {
		const preview = new Date("2026-10-25T12:00:00Z");
		const launch = new Date("2026-10-26T00:00:00Z");
		expect(shouldShowHalloweenNotice(preview)).toBe(false);
		markHalloweenNoticeSeen(preview);
		expect(shouldShowHalloweenNotice(launch)).toBe(true);
		markHalloweenNoticeSeen(launch);
		expect(shouldShowHalloweenNotice(launch)).toBe(false);
		expect(shouldShowHalloweenNotice(new Date("2026-10-31T23:59:59Z"))).toBe(
			false,
		);
	} finally {
		globalThis.localStorage = originalStorage;
	}
});
