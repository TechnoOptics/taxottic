"use client";

import { useEffect, useState } from "react";

type Props = {
  /** Set when this is the user's first dashboard visit. */
  show: boolean;
  /** Server action that flips tour_completed_at on profiles. */
  completeAction: () => Promise<void>;
  /** First name (or fallback) for the greeting. */
  displayName: string | null;
};

type Step = {
  title: string;
  body: string;
  // Optional pull-quote / footnote shown smaller below body.
  detail?: string;
  cta: string;
};

const STEPS: Step[] = [
  {
    title: "Welcome to Taxottic.",
    body: "Tax season is loud. Taxottic is calm. We turn your real-life income and expenses into a year-end forecast that holds up - and we walk you through every deduction you're entitled to.",
    detail: "5 quick screens, 30 seconds total.",
    cta: "Show me around",
  },
  {
    title: "Forecast tab is your cockpit.",
    body: "Type in income and expenses as they happen. Mark recurring items recurring. Taxottic shows you the year-end tax bill, what's already paid, and exactly how much to set aside each month.",
    cta: "Got it",
  },
  {
    title: "Bella is your tax guide.",
    body: "Tap the gold B in the bottom-right of any company page. She knows the IRC sections, the IRS publications, and how they apply to your specific situation. No jargon unless you want it.",
    cta: "Next",
  },
  {
    title: "Sales tax + Banks (coming online).",
    body: "Connect a business bank and your transactions auto-categorize. The Sales tax tab tracks what you collect, what you pay, and what you owe each state per quarter.",
    cta: "Next",
  },
  {
    title: "Hand a clean year-end packet to a CPA.",
    body: "When the year wraps, the Forecast tab exports a printable summary with EIN, address, income, expenses by Schedule C line, and IRC citations. Walk into your preparer confident.",
    cta: "Take me to the dashboard",
  },
];

export function WelcomeTour({ show, completeAction, displayName }: Props) {
  const [open, setOpen] = useState(show);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft" && index > 0) setIndex((i) => i - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  function next() {
    if (index < STEPS.length - 1) {
      setIndex(index + 1);
    } else {
      finish();
    }
  }

  function finish() {
    setOpen(false);
    // Fire-and-forget - the optimistic close above lets the user
    // proceed without waiting on the server, and the action just
    // makes sure the tour stays gone on next load.
    completeAction().catch(() => {});
  }

  if (!open) return null;
  const step = STEPS[index];
  const isFirst = index === 0;
  const personalized =
    isFirst && displayName ? `Welcome to Taxottic, ${displayName}.` : step.title;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Taxottic"
      className="fixed inset-0 z-[55] grid place-items-center px-4"
    >
      <div className="absolute inset-0 bg-forest-900/55 backdrop-blur-md" />
      <div className="relative max-w-md w-full">
        <div className="card p-7 sm:p-9">
          <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
            Step {index + 1} of {STEPS.length}
          </div>
          <h2 className="display mt-2 text-2xl sm:text-3xl text-forest-900 leading-tight">
            {personalized}
          </h2>
          <p className="mt-4 text-sm sm:text-base text-ink-soft leading-relaxed">
            {step.body}
          </p>
          {step.detail ? (
            <p className="mt-3 text-xs text-ink-muted italic">{step.detail}</p>
          ) : null}

          {/* Step pips */}
          <div className="mt-6 flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={
                  "h-1 rounded-full transition-all " +
                  (i === index
                    ? "w-8 bg-gold-500"
                    : i < index
                      ? "w-1.5 bg-gold-500"
                      : "w-1.5 bg-forest-100")
                }
              />
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={finish}
              className="text-xs text-ink-muted hover:text-forest-900"
            >
              Skip the tour
            </button>
            <div className="flex items-center gap-2">
              {index > 0 ? (
                <button
                  type="button"
                  onClick={() => setIndex(index - 1)}
                  className="btn-ghost text-sm"
                >
                  Back
                </button>
              ) : null}
              <button
                type="button"
                onClick={next}
                className="btn-primary text-sm"
                autoFocus
              >
                {step.cta}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
