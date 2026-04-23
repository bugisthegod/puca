import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Module-level capture. Chrome fires beforeinstallprompt as soon as engagement
// heuristics pass — often before the user ever opens the About modal. If the
// listener only registered inside the hook, we'd miss that early event and the
// Install button would never appear until the next page load. So we grab it at
// module import and let the hook subscribe via a notifier set.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const subscribers = new Set<() => void>();

function notify() {
  for (const s of subscribers) s();
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
    notify();
  });
}

export function useInstallPrompt() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }, []);

  async function triggerInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
    if (!deferredPrompt) return "unavailable";
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    // prompt() consumes the event — a second call would throw. Clear and notify
    // so the button hides regardless of whether the user accepted or dismissed.
    deferredPrompt = null;
    notify();
    return outcome;
  }

  // display-mode: standalone → user launched from home screen / launcher.
  // navigator.standalone is the legacy iOS Safari equivalent. Either means
  // we're running as an installed PWA and shouldn't pitch install again.
  const isStandalone = typeof window !== "undefined" && (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );

  return {
    canInstall: !!deferredPrompt,
    isInstalled: isStandalone || installed,
    triggerInstall,
  };
}
