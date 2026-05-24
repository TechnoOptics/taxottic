"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LeftRail } from "./LeftRail";

/**
 * Mobile/tablet entry point for the left-rail menu.
 *
 * The desktop rail (LeftRail mode="rail") is `hidden lg:flex`, so on
 * narrow screens we surface the same content behind a FLOATING TAB
 * on the middle-left edge of the viewport — not a header button.
 * The header used to host a hamburger, but user feedback was that
 * a top-of-viewport menu overlaid the status bar + header itself.
 * Anchoring to the middle-left keeps the OS chrome + header
 * unobstructed and matches the "swipe from the side" mental model
 * users expect on phones.
 *
 * Interactions:
 *   - Tap the tab → opens a portal-mounted sheet (same LeftRail
 *     mode="sheet" as before).
 *   - Swipe right from anywhere on the left edge (12px hit zone) →
 *     opens the sheet. Tracks deltaX over touchstart/touchmove so a
 *     ~30px rightward swipe is the open gesture; a tap-equivalent
 *     short swipe (< 6px) is treated as a tap to keep it
 *     accessible.
 *   - Inside the sheet, tap the backdrop or hit Escape to close.
 *
 * Tab is `lg:hidden` so it never appears next to the desktop rail.
 */
export function LeftRailMobile() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration: createPortal needs document, which only exists post-mount
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

  // Edge-swipe detection: 12px hit zone on the left edge. We track
  // touchstart x and follow the next move; ≥ 30px rightward delta
  // opens the menu. Listeners attach to <body> so the user can
  // start the swipe anywhere on the left edge, not just on the tab.
  const startRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStart(e: TouchEvent) {
      const t = e.touches[0];
      if (!t) return;
      if (t.clientX > 12) return; // only the left edge
      startRef.current = { x: t.clientX, y: t.clientY };
    }
    function onMove(e: TouchEvent) {
      if (!startRef.current) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startRef.current.x;
      const dy = Math.abs(t.clientY - startRef.current.y);
      // Horizontal swipe gate (dx > 30, dy < dx) so vertical scroll
      // never accidentally opens the menu.
      if (dx > 30 && dy < dx) {
        startRef.current = null;
        setOpen(true);
      }
    }
    function onEnd() {
      startRef.current = null;
    }
    document.body.addEventListener("touchstart", onStart, { passive: true });
    document.body.addEventListener("touchmove", onMove, { passive: true });
    document.body.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.body.removeEventListener("touchstart", onStart);
      document.body.removeEventListener("touchmove", onMove);
      document.body.removeEventListener("touchend", onEnd);
    };
  }, []);

  const drawer =
    open && mounted
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Main menu"
            // Push the dialog down by safe-top + header height (3.25rem).
            // Without this offset the sheet covered the OS status bar
            // AND the Taxottic header, which read as "the app
            // disappeared." Now the sheet only covers the area BELOW
            // the header, so the wordmark + safe-area chrome stay
            // visible while the menu is open — matches every
            // production iOS/Android drawer pattern.
            className="fixed inset-x-0 bottom-0 z-[60] flex"
            style={{
              top: "calc(max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)) + 3.25rem)",
            }}
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
        // Floating tab anchored to the HEADER ROW, vertically centered
        // within the brand strip so it sits in line with the TAXOTTIC
        // wordmark. The middle-left position (pre-May 23 2026) looked
        // disconnected from the header on phone-sized viewports. New
        // position uses calc(safe-top + header-half) so a notch /
        // dynamic island still gets respected.
        // `lg:hidden` keeps it out of the way when the desktop rail
        // is showing. z-50 sits above the header (z-30) but below
        // the sheet (z-60) when open.
        style={{
          top: "calc(max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)) + (var(--app-header-h, 3.25rem) / 2))",
        }}
        className="
          lg:hidden fixed left-0 -translate-y-1/2 z-50
          h-10 w-6 rounded-r-2xl
          bg-forest-900 text-cream
          shadow-[0_4px_16px_rgba(0,0,0,0.25)]
          flex items-center justify-center
          active:bg-forest-800 transition-colors
        "
      >
        {/* Three-dot grab handle: lightweight visual cue that this
            is the "more" affordance, while keeping the tab thin
            enough to never feel intrusive. */}
        <svg
          viewBox="0 0 6 14"
          width="6"
          height="14"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="3" cy="2" r="1.2" />
          <circle cx="3" cy="7" r="1.2" />
          <circle cx="3" cy="12" r="1.2" />
        </svg>
      </button>
      {drawer}
    </>
  );
}
