"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OutstandingItem } from "@/lib/tasks/outstanding";
import {
  KIND_ICON,
  loadClickedItems,
  saveClickedItems,
} from "@/components/OutstandingTasksPopup";
import { BellIcon } from "@/components/ui/Icons";

type Props = {
  count: number;
  items: OutstandingItem[];
};

type AnchorRect = { top: number; left: number; width: number };

// Base panel width (matches the old w-80 / 20rem). On very narrow phones
// (verified on a real device: a Galaxy Z Fold5's cover screen) the panel
// was overflowing past the LEFT edge of the viewport, it was positioned
// via `right: <offset from the button>` with only a CSS max-width safety
// net, which shrinks the panel but doesn't reposition it, so a
// wide-enough panel anchored too far right still spills off-screen.
// Compute an explicit LEFT position instead and clamp it in JS so the
// panel can never go off either edge, regardless of viewport quirks.
const PANEL_WIDTH = 320;
const EDGE_MARGIN = 8;

// Per-item "stop showing this" dismissals. Shared with the on-load popup via
// the SAME localStorage key, so an item X'd in either surface stays hidden in
// both. A standing preference (localStorage), not a per-session snooze.
const ITEM_DISMISS_KEY = "taxottic.outstanding.items.dismissed";
function loadDismissedItems(): Set<string> {
  try {
    const raw = localStorage.getItem(ITEM_DISMISS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function saveDismissedItems(ids: Set<string>) {
  try {
    localStorage.setItem(ITEM_DISMISS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    /* private mode / quota; the x still hides it for this render */
  }
}

/**
 * Header notification bell, the durable, always-truthful indicator of
 * outstanding tasks (unclassified drives + transactions awaiting a
 * category). Unlike the popup/banner, the bell is never dismissible:
 * it always reflects the live count so the user has one place they can
 * trust. Same portal/anchor pattern as UserMenu so it escapes the
 * header's stacking context identically.
 */
export function OutstandingTasksBell({ count, items }: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [clickedIds, setClickedIds] = useState<Set<string>>(new Set());
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration: createPortal needs document
    setMounted(true);
     
    setDismissedIds(loadDismissedItems());
     
    setClickedIds(loadClickedItems());
  }, []);

  // Link click-through: user is off to handle it; drop it from the list
  // for this session (shared sessionStorage key with the popup).
  function clickThroughItem(key: string) {
    setClickedIds((prev) => {
      const next = new Set(prev);
      next.add(key);
      saveClickedItems(next);
      return next;
    });
    setOpen(false);
  }

  function dismissItem(e: React.MouseEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(key);
      saveDismissedItems(next);
      return next;
    });
  }

  // Hide anything the user X'd out (in the bell or the popup), and keep the
  // badge honest by knocking those off the server-computed count.
  const visibleItems = items.filter((it) => {
    const key = `${it.kind}:${it.id}`;
    return !dismissedIds.has(key) && !clickedIds.has(key);
  });
  const visibleCount = Math.max(0, count - dismissedIds.size - clickedIds.size);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    let queued = false;
    let last: AnchorRect | null = null;

    function measure() {
      queued = false;
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      // Panel width shrinks to fit on screens narrower than the panel
      // itself + both margins (e.g. a phone in split-screen).
      const width = Math.min(PANEL_WIDTH, vw - EDGE_MARGIN * 2);
      // Right-align the panel's right edge under the button's right edge
      // by default, then clamp so it can never cross either margin.
      const idealLeft = r.right - width;
      const left = Math.max(
        EDGE_MARGIN,
        Math.min(idealLeft, vw - width - EDGE_MARGIN),
      );
      const next: AnchorRect = { top: r.bottom + 8, left, width };
      // The bell sits in a position:fixed header, so scrolling does not move
      // it. Writing an identical anchor re-rendered the whole panel on every
      // scroll event for no visible change; bail when the numbers match.
      if (
        last &&
        last.top === next.top &&
        last.left === next.left &&
        last.width === next.width
      ) {
        return;
      }
      last = next;
      setAnchor(next);
    }

    // One measurement per frame at most, so the forced layout that
    // getBoundingClientRect triggers stays off the scroll hot path.
    function recompute() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    }

    measure();
    window.addEventListener("resize", recompute, { passive: true });
    window.addEventListener("scroll", recompute, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const dropdown =
    open && anchor && mounted
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              top: anchor.top,
              left: anchor.left,
              width: anchor.width,
              zIndex: 9999,
              maxHeight: "calc(100vh - 32px)",
              overflowY: "auto",
            }}
            className="card card-opaque p-2 shadow-2xl"
          >
            <div className="px-3 py-2.5 border-b border-forest-100">
              <div className="text-sm font-medium text-forest-900">
                Needs your review
              </div>
              <div className="text-xs text-ink-muted">
                {visibleCount} item{visibleCount === 1 ? "" : "s"} waiting on a
                quick call
              </div>
            </div>
            <div className="py-1">
              {visibleItems.length === 0 ? (
                <div className="px-3 py-4 text-center text-[12px] text-ink-muted">
                  You&apos;re all caught up.
                </div>
              ) : (
                visibleItems.map((it) => {
                  const key = `${it.kind}:${it.id}`;
                  return (
                    <div key={key} className="relative">
                      <Link
                        href={it.href}
                        onClick={() => clickThroughItem(key)}
                        className="flex items-start gap-2.5 rounded-lg pl-3 pr-9 py-2 hover:bg-forest-50/60 transition-colors"
                      >
                        <span className="mt-0.5 text-ink-soft shrink-0">
                          {KIND_ICON[it.kind]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-forest-900 truncate">
                            {it.title}
                          </span>
                          <span className="block text-[11px] text-ink-muted truncate">
                            {it.subtitle}
                          </span>
                        </span>
                      </Link>
                      <button
                        type="button"
                        onClick={(e) => dismissItem(e, key)}
                        aria-label={`Dismiss ${it.title}`}
                        title="Just informational, stop showing this"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 size-7 rounded-full grid place-items-center text-ink-muted/70 hover:bg-forest-50 hover:text-forest-900 transition-colors"
                      >
                        <svg
                          viewBox="0 0 16 16"
                          width="12"
                          height="12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        >
                          <path d="M3 3 L13 13 M13 3 L3 13" />
                        </svg>
                      </button>
                    </div>
                  );
                })
              )}
              {visibleCount > visibleItems.length ? (
                <div className="px-3 py-2 text-[11px] text-ink-muted">
                  +{visibleCount - visibleItems.length} more
                </div>
              ) : null}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          visibleCount > 0
            ? `${visibleCount} outstanding item${visibleCount === 1 ? "" : "s"} need review`
            : "Notifications"
        }
        aria-expanded={open}
        className="relative inline-flex size-8 items-center justify-center rounded-full text-cream/85 hover:text-cream hover:bg-white/10 transition-colors"
      >
        <BellIcon className="size-[18px]" />
        {visibleCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-gold-500 px-1 text-[9px] font-semibold leading-none text-forest-950"
          >
            {visibleCount > 99 ? "99+" : visibleCount}
          </span>
        ) : null}
      </button>
      {dropdown}
    </>
  );
}
