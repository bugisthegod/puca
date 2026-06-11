type GoatCounterEvent = {
	path: string;
	title?: string;
	event?: boolean;
};

const GOATCOUNTER_URL = process.env.GOATCOUNTER_URL as string | undefined;
const ANALYTICS_HOSTS = new Set(
	((process.env.ANALYTICS_HOSTS as string | undefined) ?? "")
		.split(",")
		.map((h) => h.trim())
		.filter(Boolean),
);

declare global {
	interface Window {
		goatcounter?: {
			count?: (event: GoatCounterEvent) => void;
			path?: (location: Location) => string;
		};
	}
}

const EVENT_TITLES: Record<string, string> = {
	"event/app/open": "App open",
	"event/app/standalone-open": "App open as PWA",
	"event/mode/train": "Switch to train mode",
	"event/mode/bus": "Switch to bus mode",
	"event/search/train": "Train search",
	"event/search/bus-route": "Bus route search",
	"event/search/bus-stop": "Bus stop search",
	"event/favorite/add-train": "Add train favorite",
	"event/favorite/remove-train": "Remove train favorite",
	"event/favorite/add-bus-route": "Add bus route favorite",
	"event/favorite/remove-bus-route": "Remove bus route favorite",
	"event/favorite/add-bus-stop": "Add bus stop favorite",
	"event/favorite/remove-bus-stop": "Remove bus stop favorite",
	"event/location/request": "Request location",
	"event/pwa/installed": "PWA installed",
	"event/about/feedback": "Feedback click",
	"event/about/donate": "Donate click",
	"event/about/source": "Source click",
};

const pending: GoatCounterEvent[] = [];
let flushScheduled = false;
let goatCounterLoaded = false;

function shouldLoadGoatCounter(): boolean {
	if (typeof window === "undefined") return false;
	if (!GOATCOUNTER_URL) return false;
	if (ANALYTICS_HOSTS.size === 0) return false;
	return ANALYTICS_HOSTS.has(window.location.hostname);
}

export function loadAnalytics(): void {
	if (goatCounterLoaded || !shouldLoadGoatCounter()) return;
	goatCounterLoaded = true;

	window.goatcounter = {
		...window.goatcounter,
		path: (location) => location.pathname + location.search + location.hash,
	};

	const script = document.createElement("script");
	script.async = true;
	script.src = "https://gc.zgo.at/count.js";
	script.dataset.goatcounter = GOATCOUNTER_URL;
	script.onload = () => {
		// GC is ready — drain any events that were queued during script load
		setTimeout(flushPending, 100);
	};
	document.head.append(script);
	scheduleFlush();
}

function count(event: GoatCounterEvent): boolean {
	const fn = window.goatcounter?.count;
	if (!fn) return false;
	try {
		fn(event);
		return true;
	} catch {
		return false;
	}
}

function flushPending(): void {
	if (typeof window === "undefined") return;
	if (!window.goatcounter?.count) {
		flushScheduled = false;
		return;
	}
	while (pending.length > 0) {
		const event = pending.shift();
		if (!event) break;
		count(event);
	}
	flushScheduled = false;
}

function scheduleFlush(): void {
	if (flushScheduled || typeof window === "undefined") return;
	flushScheduled = true;
	window.addEventListener("load", flushPending, { once: true });
	setTimeout(flushPending, 1500);
}

export function trackEvent(path: keyof typeof EVENT_TITLES): void {
	if (typeof window === "undefined") return;
	try {
		loadAnalytics();
		const event = {
			path,
			title: EVENT_TITLES[path],
			event: true,
		};
		if (!count(event) && pending.length < 50) {
			pending.push(event);
			scheduleFlush();
		}
	} catch {
		// Analytics should never affect the app.
	}
}

export function isStandalonePwa(): boolean {
	if (typeof window === "undefined") return false;
	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		(navigator as { standalone?: boolean }).standalone === true
	);
}
