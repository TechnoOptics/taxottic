"use client";

import { useEffect, useState } from "react";
import { THEME_CHANGE_EVENT } from "@/components/DarkThemeMount";

const KEY = "taxottic.theme";

/**
 * Dark/Light segmented toggle, persisted to localStorage. Flipping
 * the choice updates html[data-theme] immediately (via the custom
 * event DarkThemeMount listens for) so the page re-skins without a
 * reload. Defaults to dark — same as the previous always-dark
 * behaviour — until the user opts into light.
 */
export function ThemeToggle() {
  // Render-stable initial state for SSR; corrected on mount from
  // localStorage + the live html[data-theme] attribute.
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    let initial: "dark" | "light" = "dark";
    try {
      const pref = window.localStorage.getItem(KEY);
      if (pref === "light") initial = "light";
      else if (pref === "dark") initial = "dark";
      else {
        const dom =
          document.documentElement.dataset.theme === "light"
            ? "light"
            : "dark";
        initial = dom;
      }
    } catch {
      /* private mode — keep dark */
    }
    setTheme(initial);
  }, []);

  function pick(next: "dark" | "light") {
    if (next === theme) return;
    setTheme(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* private mode — visual change still applies for this tab */
    }
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  const baseBtn =
    "flex-1 text-sm font-medium px-2 py-1.5 rounded-md transition-colors";
  const selected = "bg-cream text-forest-900";
  const unselected = "text-forest-700 hover:text-forest-900";

  return (
    <div className="px-1 py-2 border-b border-forest-100">
      <div className="px-2 pt-1 pb-2 text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
        Appearance
      </div>
      <div
        className="mx-2 inline-flex items-stretch rounded-lg p-0.5 gap-0.5 border border-forest-100"
        role="group"
        aria-label="Theme"
      >
        <button
          type="button"
          aria-pressed={theme === "dark"}
          onClick={() => pick("dark")}
          className={
            baseBtn + " " + (theme === "dark" ? selected : unselected)
          }
        >
          Dark
        </button>
        <button
          type="button"
          aria-pressed={theme === "light"}
          onClick={() => pick("light")}
          className={
            baseBtn + " " + (theme === "light" ? selected : unselected)
          }
        >
          Light
        </button>
      </div>
    </div>
  );
}
