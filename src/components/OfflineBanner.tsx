import { useSyncExternalStore } from "react";

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
  if (online) return null;
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      Offline — showing cached data
    </div>
  );
}
