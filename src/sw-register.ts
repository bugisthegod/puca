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

	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch((err) => {
			console.warn("SW registration failed:", err);
		});
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
