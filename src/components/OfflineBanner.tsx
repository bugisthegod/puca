import { useSyncExternalStore } from "react";
import { useLocale } from "../i18n";

function subscribe(callback: () => void): () => void {
	window.addEventListener("online", callback);
	window.addEventListener("offline", callback);
	return () => {
		window.removeEventListener("online", callback);
		window.removeEventListener("offline", callback);
	};
}

const getSnapshot = () => navigator.onLine;

export default function OfflineBanner() {
	const online = useSyncExternalStore(subscribe, getSnapshot);
	const { t } = useLocale();
	if (online) return null;
	return (
		<div className="offline-banner" role="status" aria-live="polite">
			{t("offline.banner")}
		</div>
	);
}
