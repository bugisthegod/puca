import { useEffect, useRef } from "react";

type ModalHistoryTarget = {
	history: Pick<History, "state" | "pushState" | "replaceState" | "back">;
	addEventListener: (type: "popstate", listener: () => void) => void;
	removeEventListener: (type: "popstate", listener: () => void) => void;
};

export function createModalHistory(target: ModalHistoryTarget) {
	let pendingBack: Promise<void> | undefined;
	let nextId = 0;
	let started = false;
	const active: number[] = [];

	return (onClose: () => void): (() => void) => {
		const id = ++nextId;
		let disposed = false;
		let installed = false;
		let popped = false;
		const onPop = () => {
			if (
				popped ||
				active.at(-1) !== id ||
				target.history.state?.modalId === id
			)
				return;
			popped = true;
			onClose();
		};
		const install = () => {
			if (disposed) return;
			if (!started) {
				started = true;
				// iOS may restore history.state after killing the WebView, while
				// React's old modal no longer exists. Retire that orphan marker.
				if (target.history.state?.puca === "modal") {
					const { puca: _, modalId: __, ...rest } = target.history.state;
					target.history.replaceState(rest, "");
				}
			}
			target.history.pushState({ puca: "modal", modalId: id }, "");
			active.push(id);
			target.addEventListener("popstate", onPop);
			installed = true;
		};
		// A previous modal's history.back() is asynchronous. Its popstate must
		// finish before the next modal pushes an entry or starts listening.
		if (pendingBack) void pendingBack.then(install);
		else install();

		return () => {
			disposed = true;
			if (!installed) return;
			installed = false;
			target.removeEventListener("popstate", onPop);
			active.splice(active.indexOf(id), 1);
			if (!popped && target.history.state?.modalId === id) {
				pendingBack = new Promise<void>((resolve) => {
					const settled = () => {
						target.removeEventListener("popstate", settled);
						pendingBack = undefined;
						resolve();
					};
					target.addEventListener("popstate", settled);
				});
				target.history.back();
			}
		};
	};
}

let registerModal: ReturnType<typeof createModalHistory> | undefined;

// Make the browser/Android back button close a modal instead of exiting the
// PWA. On mount we push a synthetic history entry; back pops it and fires
// popstate → we call onClose. On normal (X button / Escape) close, cleanup
// pops our entry so history stays clean.
//
// onClose is held in a ref so the effect runs exactly once per mount/unmount.
// If we depended on [onClose] directly, any parent re-render with an inline
// arrow would re-run cleanup → history.back() (async popstate) → fires the
// freshly-attached new listener → closes the modal unexpectedly.
export function useBackToClose(onClose: () => void) {
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		registerModal ??= createModalHistory(window);
		return registerModal(() => onCloseRef.current());
	}, []);
}
