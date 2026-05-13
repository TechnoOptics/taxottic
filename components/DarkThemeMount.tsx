"use client";

import { useEffect } from "react";

/**
 * Mounts the dark theme on every authenticated page.
 *
 * Why a client component:
 *   - `data-theme="dark"` lives on `<html>` so the CSS overrides in
 *     globals.css (`html[data-theme="dark"] .card`, etc.) can target
 *     the whole document. From a server component you can't mutate
 *     <html> after render without a layout boundary.
 *   - Setting it via useEffect avoids a hydration mismatch: the
 *     server renders the page with no theme attribute (light cream
 *     default), then on mount we flip to dark. A tiny no-op for SEO
 *     while the JS hydrates, and zero risk of a flash-of-wrong-theme
 *     since the body's transition: background-color animation soaks
 *     up the half-second flip.
 *   - Cleanup removes the attribute on unmount so navigating from an
 *     authenticated route back to a marketing route reverts to
 *     light. The pattern: dark = authenticated; light = public.
 *
 * Where it's mounted:
 *   - components/AppHeader.tsx renders <DarkThemeMount /> exactly
 *     once per page render. That covers dashboard, /c/[publicId]/*,
 *     /admin, /firm, /settings, and every other route that uses
 *     <AppHeader>.
 *   - Public marketing routes (app/page.tsx, /legal/**, /pricing,
 *     /help, /changelog, /example) don't render <AppHeader>, so they
 *     stay light — by intent.
 *
 * Same pattern as <HeaderScrollHider> elsewhere in this codebase —
 * a server component declaration that "summons" a tiny client side
 * effect.
 */
export function DarkThemeMount() {
  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    return () => {
      // Remove the attribute when this header unmounts, so the next
      // page (which might be marketing) renders light again.
      delete document.documentElement.dataset.theme;
    };
  }, []);
  return null;
}
