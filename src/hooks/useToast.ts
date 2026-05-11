import { useCallback, useState } from "react";

export type Toast = { title: string; body?: string };

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((title: string, body?: string, ms = 3000) => {
    const next = { title, body };
    setToast(next);
    setTimeout(() => setToast((t) => (t?.title === title ? null : t)), ms);
  }, []);

  return { toast, showToast };
}
