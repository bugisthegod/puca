import { useEffect, useState } from "react";

const THEME_KEY = "puca:theme";
const FAB_SIDE_KEY = "puca:fab-side";

export type ThemePref = "light" | "dark" | "system";
export type FabSide = "left" | "right";

function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

function readFabSide(): FabSide {
  try {
    const v = localStorage.getItem(FAB_SIDE_KEY);
    if (v === "left" || v === "right") return v;
  } catch {}
  return "right";
}

export function applyInitialAppearance(): void {
  document.documentElement.dataset.theme = resolveTheme(readThemePref());
  document.documentElement.dataset.fabSide = readFabSide();
}

export function useThemePreference() {
  const [theme, setTheme] = useState<ThemePref>(readThemePref);

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme);
      // Notify useMapInstance to swap the base tile layer.
      window.dispatchEvent(new Event("puca:themechange"));
    };
    apply();
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
    // Only track OS preference changes while the user is on "system" — explicit
    // light/dark choices should win regardless of OS.
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  return { theme, setTheme };
}

export function useFabSidePreference() {
  const [fabSide, setFabSide] = useState<FabSide>(readFabSide);

  useEffect(() => {
    document.documentElement.dataset.fabSide = fabSide;
    try { localStorage.setItem(FAB_SIDE_KEY, fabSide); } catch {}
  }, [fabSide]);

  return { fabSide, setFabSide };
}
