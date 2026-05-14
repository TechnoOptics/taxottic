"use client";

import { useEffect, useRef, useState } from "react";

// Tiny info popover for the "Tax-ready · NN%" metric on the dashboard
// company cards. Round-2 audit: the percentage isn't explained in-product,
// and the native `title` attribute is invisible on touch. This renders a
// keyboard-focusable info button that toggles a panel on click — works on
// both pointer and touch — and surfaces both the inputs and the formula.
//
// All math is rendered in plain English so the user doesn't have to
// know that "engagement × 50% + coverage × 50%" is what we mean by
// blending.

export type ReadinessHelpProps = {
  score: number;
  triagedTx: number;
  totalTx: number;
  categoriesUsed: number;
  targetCategories: number;
  hasBankFeed: boolean;
};

export function ReadinessHelp({
  score,
  triagedTx,
  totalTx,
  categoriesUsed,
  targetCategories,
  hasBankFeed,
}: ReadinessHelpProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside / Esc-to-close. Mounted only while open so the listener
  // doesn't ride around on the page forever.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const coveragePct = Math.round(
    Math.min(categoriesUsed / Math.max(targetCategories, 1), 1) * 100,
  );
  const engagementPct =
    hasBankFeed && totalTx > 0 ? Math.round((triagedTx / totalTx) * 100) : null;

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="How is tax-ready percentage calculated?"
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gold-400 text-[9px] font-semibold leading-none text-gold-700 hover:bg-gold-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 dark:border-gold-500/40 dark:text-gold-300 dark:hover:bg-gold-900/30"
      >
        ?
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Tax-ready score explained"
          // Width clamps so we don't overflow a 320px viewport. On the
          // narrowest phones the popover fills the available column
          // (minus 1.5rem so it doesn't kiss the page edge); on tablet+
          // it's a fixed 288px card.
          className="absolute left-0 top-6 z-20 w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-cream-300 bg-white p-4 text-left shadow-lg dark:border-forest-700 dark:bg-forest-900"
        >
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-gold-700">
            Tax-ready · {score}%
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-soft dark:text-cream-200">
            {hasBankFeed
              ? "Two equally-weighted parts: how much of your imported bank activity you've triaged, and how many distinct deduction categories you've claimed this year."
              : "Right now this score reflects only the deduction categories you've claimed this year. Connect a bank feed to add a second axis (transaction triage)."}
          </p>
          <ul className="mt-3 space-y-2 text-[11px] leading-relaxed text-forest-900 dark:text-cream-100">
            {hasBankFeed ? (
              <li className="flex items-baseline justify-between gap-2">
                <span className="text-ink-muted">Transactions triaged</span>
                <span className="font-medium tabular-nums">
                  {triagedTx}/{totalTx}
                  <span className="ml-1 text-ink-muted">({engagementPct}%)</span>
                </span>
              </li>
            ) : null}
            <li className="flex items-baseline justify-between gap-2">
              <span className="text-ink-muted">Categories claimed</span>
              <span className="font-medium tabular-nums">
                {categoriesUsed}/{targetCategories}
                <span className="ml-1 text-ink-muted">({coveragePct}%)</span>
              </span>
            </li>
          </ul>
          <div className="mt-3 rounded-md bg-cream-100 px-2 py-1.5 text-[11px] leading-relaxed text-ink-soft dark:bg-forest-800/60 dark:text-cream-200">
            {hasBankFeed
              ? "Score = average of the two percentages."
              : "Score = categories claimed / 8."}{" "}
            Triage transactions on the Import page and log expenses across more
            categories to move the needle.
          </div>
        </div>
      ) : null}
    </div>
  );
}
