import { useCallback, useEffect, useRef, useState } from "react";

export type Toast = { title: string; body?: string };

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((title: string, body?: string, ms = 3000) => {
    const next = { title, body };
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToast(next);
    timeoutRef.current = setTimeout(() => {
      setToast((t) => (t === next ? null : t));
      timeoutRef.current = null;
    }, ms);
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return { toast, showToast };
}
