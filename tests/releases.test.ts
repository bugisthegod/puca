import { expect, test } from "bun:test";
import {
	hasUnreadRelease,
	latestRelease,
	markReleaseSeen,
	RELEASE_SEEN_KEY,
} from "../src/client/releases";

test("a release appears once, and a later release becomes unread", () => {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
	};
	expect(hasUnreadRelease(storage)).toBe(true);
	markReleaseSeen(storage);
	expect(values.get(RELEASE_SEEN_KEY)).toBe(latestRelease.id);
	expect(hasUnreadRelease(storage)).toBe(false);
	values.set(RELEASE_SEEN_KEY, "older-release");
	expect(hasUnreadRelease(storage)).toBe(true);
});

test("unavailable storage does not prevent showing or dismissing a release", () => {
	const storage = {
		getItem: (): string | null => {
			throw new Error("Storage unavailable");
		},
		setItem: () => {
			throw new Error("Storage unavailable");
		},
	};
	expect(hasUnreadRelease(storage)).toBe(true);
	expect(() => markReleaseSeen(storage)).not.toThrow();
});
