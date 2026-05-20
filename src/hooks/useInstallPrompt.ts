import { useSyncExternalStore } from "react";
import { isStandalonePwa, trackEvent } from "../analytics";

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Module-level capture. Chrome fires beforeinstallprompt as soon as engagement
// heuristics pass — often before the user ever opens the About modal. If the
// listener only registered inside the hook, we'd miss that early event and the
// Install button would never appear until the next page load.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const subscribers = new Set<() => void>();

function notify() {
	for (const s of subscribers) s();
}

function subscribe(callback: () => void): () => void {
	subscribers.add(callback);
	return () => {
		subscribers.delete(callback);
	};
}

if (typeof window !== "undefined") {
	window.addEventListener("beforeinstallprompt", (e) => {
		e.preventDefault();
		deferredPrompt = e as BeforeInstallPromptEvent;
		notify();
	});
	window.addEventListener("appinstalled", () => {
		installed = true;
		deferredPrompt = null;
		trackEvent("event/pwa/installed");
		notify();
	});
}

const getCanInstall = () => deferredPrompt !== null;
const getInstalled = () => installed;

// display-mode: standalone → user launched from home screen / launcher.
// navigator.standalone is the legacy iOS Safari equivalent. Either means
// we're running as an installed PWA and shouldn't pitch install again.
// Captured at module load — standalone-ness is fixed for the lifetime of
// a window, so re-querying matchMedia on every render is wasted work.
const isStandalone = typeof window !== "undefined" && isStandalonePwa();

async function triggerInstall(): Promise<
	"accepted" | "dismissed" | "unavailable"
> {
	if (!deferredPrompt) return "unavailable";
	await deferredPrompt.prompt();
	const { outcome } = await deferredPrompt.userChoice;
	// prompt() consumes the event — a second call would throw. Clear and notify
	// so the button hides regardless of whether the user accepted or dismissed.
	deferredPrompt = null;
	notify();
	return outcome;
}

export function useInstallPrompt() {
	const canInstall = useSyncExternalStore(subscribe, getCanInstall);
	const installedFromEvent = useSyncExternalStore(subscribe, getInstalled);

	return {
		canInstall,
		isInstalled: isStandalone || installedFromEvent,
		triggerInstall,
	};
}
