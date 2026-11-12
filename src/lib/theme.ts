// Tema tampilan: terang, gelap, atau ikut pengaturan perangkat. Pilihan disimpan di browser ini saja.
import { useCallback, useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const KEY = "bt_theme";
const QUERY = "(prefers-color-scheme: dark)";

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(pref: ThemePref): Theme {
  if (pref !== "system") return pref;
  return typeof window !== "undefined" && window.matchMedia?.(QUERY).matches ? "dark" : "light";
}

export function applyTheme(pref: ThemePref) {
  const theme = resolveTheme(pref);
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#151514" : "#f4f3ee");
  return theme;
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readPref()));

  // Kalau memilih "ikut perangkat", ikuti perubahan di perangkat (mis. otomatis gelap malam hari).
  useEffect(() => {
    setTheme(applyTheme(pref));
    if (pref !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setTheme(applyTheme("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  // Tab lain yang mengubah tema ikut tersinkron.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) setPrefState(readPref());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPref = useCallback((next: ThemePref) => {
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* tidak masalah: tema tetap berganti sampai halaman ditutup */
    }
    setPrefState(next);
  }, []);

  return { pref, theme, setPref, toggle: () => setPref(theme === "dark" ? "light" : "dark") };
}
