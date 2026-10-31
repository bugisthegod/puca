import { expect, test } from "bun:test";
import { bindBusRouteJumpButton } from "../src/client/hooks/busRouteJumpButton";

function popupButton(attributes: Record<string, string | undefined>) {
	let handler: (() => void) | null = null;
	const listeners: (() => void)[] = [];
	const button = {
		get onclick() {
			return handler;
		},
		set onclick(next: (() => void) | null) {
			handler = next;
		},
		addEventListener(_event: string, listener: () => void) {
			listeners.push(listener);
		},
		getAttribute(name: string) {
			return attributes[name] ?? null;
		},
	};
	return {
		root: { querySelector: () => button } as unknown as ParentNode,
		click() {
			handler?.();
			for (const listener of listeners) listener();
		},
	};
}

test("reopening a popup replaces its route callback instead of duplicating jumps", () => {
	const popup = popupButton({
		"data-route": "C1%20Express",
		"data-dir": "0",
		"data-operator": "dublinbus",
	});
	let previousCalls = 0;
	const selected: unknown[][] = [];
	bindBusRouteJumpButton(popup.root, () => previousCalls++);
	for (let attempt = 0; attempt < 4; attempt++) {
		bindBusRouteJumpButton(popup.root, (...args) => selected.push(args));
	}
	popup.click();
	expect(previousCalls).toBe(0);
	expect(selected).toEqual([["C1 Express", "0", "dublinbus"]]);
});

test("missing route or direction never triggers navigation", () => {
	let calls = 0;
	for (const attributes of [{ "data-route": "C1" }, { "data-dir": "1" }, {}]) {
		const popup = popupButton(attributes);
		bindBusRouteJumpButton(popup.root, () => calls++);
		popup.click();
	}
	bindBusRouteJumpButton(undefined, () => calls++);
	bindBusRouteJumpButton(
		{ querySelector: () => null } as unknown as ParentNode,
		() => calls++,
	);
	expect(calls).toBe(0);
});
