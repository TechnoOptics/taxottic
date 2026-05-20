"use client";

import { useEffect } from "react";

const THEME_KEY = "taxottic.theme";
export const THEME_CHANGE_EVENT = "taxottic-theme-change";

/**
 * Mounts a theme on every authenticated page (kept the legacy name
 * "DarkThemeMount" so existing imports don't churn — but it now
 * reads a user preference from localStorage and falls back to "dark"
 * for backward compatibility with the previous always-dark behaviour).
 *
 * Why a client component:
 *   - `data-theme="dark"` (or "light") lives on `<html>` so CSS
 *     overrides in globals.css (`html[data-theme="dark"] .card`,
 *     etc.) can target the whole document. From a server component
 *     you can't mutate <html> after render without a layout
 *     boundary.
 *   - Setting it via useEffect avoids a hydration mismatch.
 *
 * Cleanup removes the attribute on unmount so navigating from an
 * authenticated route back to a marketing route reverts to the
 * codebase default (light cream).
 *
 * <ThemeToggle> in the UserMenu writes to localStorage and fires
 * THEME_CHANGE_EVENT so this mount picks up the change without a
 * page reload. Cross-tab sync via the standard `storage` event.
 */
export function DarkThemeMount() {
  useEffect(() => {
    const apply = () => {
      let theme: "dark" | "light" = "dark";
      try {
        const pref = window.localStorage.getItem(THEME_KEY);
        if (pref === "light") theme = "light";
        else if (pref === "dark") theme = "dark";
      } catch {
        /* private mode — keep default */
      }
      document.documentElement.dataset.theme = theme;
    };
    apply();
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) apply();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_CHANGE_EVENT, apply as EventListener);
    return () => {
      delete document.documentElement.dataset.theme;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        THEME_CHANGE_EVENT,
        apply as EventListener,
      );
    };
  }, []);
  return null;
}
