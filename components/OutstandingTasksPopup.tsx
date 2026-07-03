"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { OutstandingItem } from "@/lib/tasks/outstanding";

type Props = {
  count: number;
  items: OutstandingItem[];
};

const KIND_ICON: Record<OutstandingItem["kind"], string> = {
  trip: "🚗",
  csv_transaction: "🧾",
  bank_transaction: "🏦",
};

// One popup per browser SESSION (not per page nav) — sessionStorage
// survives client-side navigation but clears when the tab/app closes,
// so the user sees this again next time they open the app, but not on
// every internal link click during the same visit.
const DISMISS_KEY = "taxottic.outstanding.popup.dismissed";

// Per-item "not now, and don't ask again" — separate from DISMISS_KEY
// above (which hides the WHOLE popup for the rest of the session).
// localStorage (not sessionStorage) because dismissing one specific
// item is a standing preference ("this one's just informational, stop
// showing it to me"), not a one-session snooze. Keyed by "kind:id" to
// match the list's own React key.
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
    /* private mode / quota — the x still hides it for this render */
  }
}

/**
 * On-load "you have outstanding items" popup. Surfaces once per
 * session when there's anything needing review. Closing it does NOT
 * lose the items — they stay live in the header bell (and the slim
 * banner) for the rest of the session; this popup just doesn't nag
 * again until the next fresh session.
 */
export function OutstandingTasksPopup({ count, items }: Props) {
  const [open, setOpen] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (count <= 0) return;
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* private mode — show it anyway, no memory across reloads either */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot on-load surfacing, condition depends on browser storage only readable client-side
    setDismissedIds(loadDismissedItems());
    setOpen(true);
  }, [count]);

  // The mobile "open menu" FAB (LeftRailMobile) is portaled straight to
  // document.body with its own fixed positioning + z-index — verified on a
  // real device (Galaxy Z Fold5) that it was rendering ON TOP of this
  // modal's Review/Not-now buttons despite a numerically lower z-index,
  // i.e. it isn't a simple stacking-order fix. Toggling a body class the
  // FAB explicitly hides on (see .modal-open-hide-fab in globals.css) is
  // the guaranteed-correct fix regardless of the exact stacking mechanism.
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("modal-open-hide-fab");
    return () => document.body.classList.remove("modal-open-hide-fab");
  }, [open]);

  function close() {
    setOpen(false);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode — will simply show again next reload, acceptable */
    }
  }

  function dismissItem(e: React.MouseEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();
    const next = new Set(dismissedIds);
    next.add(key);
    setDismissedIds(next);
    saveDismissedItems(next);
  }

  if (!open) return null;

  const visibleItems = items.filter(
    (it) => !dismissedIds.has(`${it.kind}:${it.id}`),
  );
  // The server-computed `count` includes items past the preview cap
  // AND anything just dismissed locally — knock off local dismissals so
  // the heading stays honest about what's actually still showing.
  const visibleCount = Math.max(0, count - dismissedIds.size);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[70] grid place-items-center p-3 sm:p-6"
      onClick={close}
    >
      <div className="absolute inset-0 bg-forest-900/40 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative card p-6 max-w-md w-full"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute top-3 right-3 size-8 rounded-full grid place-items-center text-ink-soft hover:bg-cream hover:text-forest-900"
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M3 3 L13 13 M13 3 L3 13" />
          </svg>
        </button>

        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Welcome back
        </div>
        <h2 className="display text-2xl text-forest-900 mt-1">
          {visibleCount} item{visibleCount === 1 ? "" : "s"} need
          {visibleCount === 1 ? "s" : ""} a quick review
        </h2>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed">
          A drive or transaction can&apos;t count toward your deduction until
          you say business or personal. Clear these now, or close this and
          they&apos;ll stay in the bell at the top of the page. Just here for
          your info? Tap the × on a row to stop seeing it.
        </p>

        <ul className="mt-4 grid gap-1 max-h-64 overflow-y-auto">
          {visibleItems.map((it) => {
            const key = `${it.kind}:${it.id}`;
            return (
              <li key={key} className="relative">
                <Link
                  href={it.href}
                  onClick={close}
                  className="flex items-start gap-2.5 rounded-lg pl-3 pr-9 py-2 hover:bg-cream transition-colors"
                >
                  <span
                    aria-hidden="true"
                    className="text-base leading-none mt-0.5"
                  >
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
                  title="Just informational — stop showing this"
                  // Always visible, not hover-only: this app is primarily used
                  // on touchscreens, which have no hover state, so an
                  // opacity-0-until-:hover button is invisible AND
                  // unreachable there (confirmed on a real device).
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 size-7 rounded-full grid place-items-center text-ink-muted/70 hover:bg-cream hover:text-forest-900 transition-colors"
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
              </li>
            );
          })}
          {count > items.length ? (
            <li className="px-3 py-1.5 text-[11px] text-ink-muted">
              +{count - items.length} more
            </li>
          ) : null}
        </ul>

        <div className="mt-5 flex items-center gap-3">
          <Link
            href={visibleItems[0]?.href ?? "/mileage/classify"}
            className="btn-primary text-sm"
          >
            Review now
          </Link>
          <button
            type="button"
            onClick={close}
            className="text-sm text-ink-soft hover:text-forest-900"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
