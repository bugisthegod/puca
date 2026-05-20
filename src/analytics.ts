type GoatCounterEvent = {
	path: string;
	title?: string;
	event?: boolean;
};

declare global {
	interface Window {
		goatcounter?: {
			count?: (event: GoatCounterEvent) => void;
		};
	}
}

const EVENT_TITLES: Record<string, string> = {
	"event/app/open": "App open",
	"event/app/standalone-open": "App open as PWA",
	"event/mode/train": "Switch to train mode",
	"event/mode/bus": "Switch to bus mode",
	"event/bus/operator/dublinbus": "Select Dublin Bus",
	"event/bus/operator/buseireann": "Select Bus Eireann",
	"event/bus/operator/goahead": "Select Go-Ahead",
	"event/search/train": "Train search",
	"event/search/bus-route": "Bus route search",
	"event/search/bus-stop": "Bus stop search",
	"event/search/bus-arrival": "Bus arrival focus",
	"event/search/train-select": "Train result select",
	"event/favorite/add-train": "Add train favorite",
	"event/favorite/remove-train": "Remove train favorite",
	"event/favorite/add-bus-route": "Add bus route favorite",
	"event/favorite/remove-bus-route": "Remove bus route favorite",
	"event/favorite/add-bus-stop": "Add bus stop favorite",
	"event/favorite/remove-bus-stop": "Remove bus stop favorite",
	"event/favorite/pick-train": "Pick train favorite",
	"event/favorite/pick-bus-route": "Pick bus route favorite",
	"event/favorite/pick-bus-stop": "Pick bus stop favorite",
	"event/location/request": "Request location",
	"event/location/success": "Location success",
	"event/location/error": "Location error",
	"event/pwa/install-available": "PWA install available",
	"event/pwa/install-click": "PWA install click",
	"event/pwa/install-accepted": "PWA install accepted",
	"event/pwa/install-dismissed": "PWA install dismissed",
	"event/pwa/installed": "PWA installed",
	"event/about/open": "Open about",
	"event/about/share": "Share copied",
	"event/about/feedback": "Feedback click",
	"event/about/donate": "Donate click",
	"event/about/tour": "Tour click",
	"event/error/api-trains": "Train API error",
	"event/error/api-bus-vehicles": "Bus vehicles API error",
	"event/error/api-train-search": "Train search API error",
	"event/error/api-bus-arrivals": "Bus arrivals API error",
	"event/error/sw-registration": "Service worker registration error",
};

const pending: GoatCounterEvent[] = [];
let flushScheduled = false;

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
