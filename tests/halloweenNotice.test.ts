import { expect, test } from "bun:test";
import {
	canOpenHalloweenNotice,
	isHalloweenEventActive,
} from "../src/client/components/HalloweenNotice";

test("Halloween announcement runs Oct 26–31 in Dublin", () => {
	expect(isHalloweenEventActive(new Date("2026-10-25T23:59:59Z"))).toBe(false);
	expect(isHalloweenEventActive(new Date("2026-10-26T00:00:00Z"))).toBe(true);
	expect(isHalloweenEventActive(new Date("2026-10-31T23:59:59Z"))).toBe(true);
	expect(isHalloweenEventActive(new Date("2026-11-01T00:00:00Z"))).toBe(false);
});

test("About allows a preview today without activating the campaign", () => {
	const today = new Date("2026-10-25T12:00:00Z");
	expect(canOpenHalloweenNotice(today)).toBe(true);
	expect(isHalloweenEventActive(today)).toBe(false);
	expect(canOpenHalloweenNotice(new Date("2026-11-01T00:00:00Z"))).toBe(false);
});
