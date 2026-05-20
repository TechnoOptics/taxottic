"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LeftRail } from "./LeftRail";

/**
 * Mobile/tablet entry point for the left-rail menu.
 *
 * The desktop rail (LeftRail mode="rail") is `hidden lg:flex`, so on
 * narrow screens we surface the same content behind a hamburger
 * button in the top-bar. Tapping the button opens a portal-mounted
 * backdrop with the rail in "sheet" mode (full-width drawer);
 * tapping the backdrop, hitting Escape, or selecting a menu item
 * closes it.
 *
 * Lives next to the wordmark on `< lg` widths and is hidden on lg+.
 */
export function LeftRailMobile() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const drawer =
    open && mounted
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Main menu"
            className="fixed inset-0 z-[60] flex"
          >
            <div
              className="absolute inset-0 bg-forest-900/50 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <div className="relative h-full">
              <LeftRail mode="sheet" onDismiss={() => setOpen(false)} />
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="lg:hidden grid place-items-center size-9 rounded-full border border-forest-200 bg-paper text-forest-800 hover:bg-cream"
      >
        <svg
          viewBox="0 0 20 20"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M3 6h14M3 10h14M3 14h14" />
        </svg>
      </button>
      {drawer}
    </>
  );
}
