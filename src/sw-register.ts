import { trackEvent } from "./analytics";

export function registerServiceWorker() {
	if (!("serviceWorker" in navigator)) return;

	if (isDevHost()) {
		navigator.serviceWorker.getRegistrations().then((regs) => {
			for (const reg of regs) reg.unregister();
		});
		if (window.caches) {
			caches.keys().then((keys) => {
				for (const k of keys) caches.delete(k);
			});
		}
		return;
	}

	let reloadingForUpdate = false;

	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (reloadingForUpdate) return;
		reloadingForUpdate = true;
		window.location.reload();
	});

	navigator.serviceWorker
		.register("/sw.js", { updateViaCache: "none" })
		.then((registration) => {
			registration.update().catch(() => {});
		})
		.catch((err) => {
			console.warn("SW registration failed:", err);
		});
}

function isDevHost(): boolean {
	const { hostname } = window.location;
	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname.endsWith(".local") ||
		/^10\./.test(hostname) ||
		/^192\.168\./.test(hostname) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
	);
}
