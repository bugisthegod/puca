import { useEffect, useRef } from "react";

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
    history.pushState({ puca: "modal" }, "");
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (history.state?.puca === "modal") history.back();
    };
  }, []);
}
