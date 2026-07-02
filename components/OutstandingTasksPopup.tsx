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

/**
 * On-load "you have outstanding items" popup. Surfaces once per
 * session when there's anything needing review. Closing it does NOT
 * lose the items — they stay live in the header bell (and the slim
 * banner) for the rest of the session; this popup just doesn't nag
 * again until the next fresh session.
 */
export function OutstandingTasksPopup({ count, items }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (count <= 0) return;
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* private mode — show it anyway, no memory across reloads either */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot on-load surfacing, condition depends on browser storage only readable client-side
    setOpen(true);
  }, [count]);

  function close() {
    setOpen(false);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode — will simply show again next reload, acceptable */
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[70] grid place-items-end sm:place-items-center px-3 pb-3 sm:p-6"
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
          {count} item{count === 1 ? "" : "s"} need{count === 1 ? "s" : ""} a
          quick review
        </h2>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed">
          A drive or transaction can&apos;t count toward your deduction until
          you say business or personal. Clear these now, or close this and
          they&apos;ll stay in the bell at the top of the page.
        </p>

        <ul className="mt-4 grid gap-1 max-h-64 overflow-y-auto">
          {items.map((it) => (
            <li key={`${it.kind}:${it.id}`}>
              <Link
                href={it.href}
                onClick={close}
                className="flex items-start gap-2.5 rounded-lg px-3 py-2 hover:bg-cream transition-colors"
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
            </li>
          ))}
          {count > items.length ? (
            <li className="px-3 py-1.5 text-[11px] text-ink-muted">
              +{count - items.length} more
            </li>
          ) : null}
        </ul>

        <div className="mt-5 flex items-center gap-3">
          <Link href={items[0]?.href ?? "/mileage/classify"} className="btn-primary text-sm">
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
