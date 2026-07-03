"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LeftRail } from "./LeftRail";

type Company = {
  publicId: string;
  name: string;
  role?: "manager" | "lead" | "member";
};

/**
 * Mobile/tablet entry point for the left-rail menu.
 *
 * (May 25 2026 redesign) The opener is now a BOTTOM-LEFT FAB. The
 * previous middle-left tab anchored to the header row read as if it
 * was "on" the brand strip — user feedback "the menu opener is
 * overlaying the header". A bottom-left FAB sits in thumb territory,
 * never touches the header, and matches the mental model of a
 * standard mobile "open menu" affordance.
 *
 * Interactions:
 *   - Tap the FAB → opens a portal-mounted sheet (LeftRail
 *     mode="sheet"). The sheet renders below the header so the
 *     wordmark + safe-area chrome stay visible.
 *   - Swipe right from anywhere on the left edge (12 px hit zone) →
 *     opens the sheet. Tracks deltaX over touchstart/touchmove so a
 *     ≥ 30 px rightward swipe is the open gesture; a tap-equivalent
 *     short swipe is ignored to avoid false opens during scroll.
 *   - Inside the sheet, tap the backdrop or hit Escape to close.
 *
 * `lg:hidden` keeps the FAB out of the way when the desktop rail is
 * showing.
 */
export function LeftRailMobile({ companies = [] }: { companies?: Company[] }) {
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
  // touchstart x and follow the next move; ≥ 30 px rightward delta
  // opens the menu. Listeners attach to <body> so the user can start
  // the swipe anywhere on the left edge, not just on the FAB.
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
            // Full-viewport overlay so the dimmed backdrop covers
            // EVERYTHING, but the menu itself is anchored to the
            // bottom-left corner (above the FAB) and grows upward.
            // User feedback (May 25 2026): "make the menu open from
            // the bottom left corner of the screen not the top" —
            // the previous full-width-from-below-header sheet read
            // as "the whole app got replaced by a menu", which was
            // disorienting.
            className="fixed inset-0 z-[60]"
          >
            <div
              className="absolute inset-0 bg-forest-900/50 backdrop-blur-sm animate-[fadeIn_.15s_ease]"
              onClick={() => setOpen(false)}
            />
            {/* Menu panel anchored to bottom-left, above the FAB.
                Height capped to leave room for the header + safe-top
                + the FAB itself, so the panel never overlaps the FAB
                or the brand strip. Width is content-driven via
                LeftRail's sheet mode (~w-64) and capped at 85vw on
                phones. Slides up from the FAB with a small spring. */}
            <div
              className="absolute origin-bottom-left animate-[slideUpFromCorner_.22s_cubic-bezier(.2,.8,.2,1)]"
              style={{
                bottom:
                  "calc(max(var(--safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + 5rem)",
                left:
                  "calc(max(env(safe-area-inset-left, 0px), 0px) + 1rem)",
                maxHeight:
                  "calc(100vh - max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)) - 3.25rem - 6rem)",
                maxWidth: "calc(100vw - 2rem)",
              }}
            >
              <LeftRail
                mode="sheet"
                onDismiss={() => setOpen(false)}
                companies={companies}
              />
            </div>
          </div>,
          document.body,
        )
      : null;

  // Portal the FAB to document.body — same as the drawer. AppHeader
  // mounts <LeftRailMobile> INSIDE the .app-header element, and
  // .app-header carries `backdrop-filter: blur()` for its frosted look.
  // A filter / backdrop-filter makes that element the containing block
  // for `position: fixed` descendants (CSS Containing Block spec), so
  // the FAB's `bottom/left` were measured against the ~52px header
  // instead of the viewport — it rendered stuck in the top-left status
  // bar instead of the bottom-left corner. Mounting on <body> (no
  // filtered ancestor) restores true viewport-fixed positioning.
  const fab = mounted
    ? createPortal(
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          // Bottom-left FAB. Sits above the safe-bottom inset (gesture
          // bar on Android, home-indicator on iOS) so it never gets
          // covered. 56 px square is the standard FAB size — large
          // enough for a thumb tap, small enough to not crowd content.
          // z-50 sits above the header (z-30) but below the sheet
          // (z-60) when open.
          style={{
            bottom:
              "calc(max(var(--safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + 1rem)",
            left:
              "calc(max(env(safe-area-inset-left, 0px), 0px) + 1rem)",
          }}
          className="
            lg:hidden fixed z-50
            h-14 w-14 rounded-full
            bg-forest-900 text-cream
            shadow-[0_8px_24px_rgba(0,0,0,0.35)]
            flex items-center justify-center
            active:bg-forest-800 active:scale-95
            transition-transform
          "
        >
          {/* Hamburger icon — bigger and more recognizable than the
              previous 3-dot grab handle. */}
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>,
        document.body,
      )
    : null;

  return (
    <>
      {fab}
      {drawer}
    </>
  );
}
