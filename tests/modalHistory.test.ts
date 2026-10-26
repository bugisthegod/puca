import { expect, test } from "bun:test";
import { createModalHistory } from "../src/client/hooks/useBackToClose";

function browser(initialState: unknown = null) {
	const events = new EventTarget();
	const entries: unknown[] = [initialState];
	const traversals: number[] = [];
	let index = 0;
	let backCalls = 0;
	const history = {
		get state() {
			return entries[index];
		},
		pushState(state: unknown) {
			entries.splice(++index, entries.length, state);
		},
		replaceState(state: unknown) {
			entries[index] = state;
		},
		back() {
			backCalls++;
			if (index > 0) traversals.push(index - 1);
		},
	};
	return {
		history,
		addEventListener: (type: "popstate", callback: () => void) =>
			events.addEventListener(type, callback),
		removeEventListener: (type: "popstate", callback: () => void) =>
			events.removeEventListener(type, callback),
		get index() {
			return index;
		},
		get backCalls() {
			return backCalls;
		},
		async flushBack() {
			const next = traversals.shift();
			if (next === undefined) throw new Error("No pending history traversal");
			index = next;
			events.dispatchEvent(new Event("popstate"));
			await Promise.resolve();
		},
	};
}

test("About-to-ticket handoffs can repeat without the previous back event closing the ticket", async () => {
	const target = browser();
	const open = createModalHistory(target);
	for (let attempt = 0; attempt < 4; attempt++) {
		let aboutClosed = 0;
		let ticketClosed = 0;
		const closeAbout = open(() => aboutClosed++);
		closeAbout();
		const closeTicket = open(() => ticketClosed++);
		await target.flushBack();
		expect(aboutClosed).toBe(0);
		expect(ticketClosed).toBe(0);
		expect(target.index).toBe(1);
		target.history.back();
		await target.flushBack();
		expect(ticketClosed).toBe(1);
		const beforeCleanup = target.backCalls;
		closeTicket();
		expect(target.backCalls).toBe(beforeCleanup);
		expect(target.index).toBe(0);
	}
});

test("an interrupted handoff cannot install a modal after it has unmounted", async () => {
	const target = browser();
	const open = createModalHistory(target);
	open(() => {})();
	let closed = 0;
	const disposeTicket = open(() => closed++);
	disposeTicket();
	await target.flushBack();
	expect(target.index).toBe(0);
	expect(closed).toBe(0);
	const disposeNext = open(() => closed++);
	disposeNext();
	await target.flushBack();
	expect(target.index).toBe(0);
});

test("a cold restart retires the restored modal marker and allows manual replay", async () => {
	const target = browser({ puca: "modal", modalId: 42, appState: "preserved" });
	const open = createModalHistory(target);
	const closeAbout = open(() => {});
	closeAbout();
	let ticketClosed = 0;
	const closeTicket = open(() => ticketClosed++);
	await target.flushBack();
	expect(ticketClosed).toBe(0);
	closeTicket();
	await target.flushBack();
	expect(target.history.state).toEqual({ appState: "preserved" });
	expect(target.index).toBe(0);
});
