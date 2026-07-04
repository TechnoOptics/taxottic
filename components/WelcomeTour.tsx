"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  /** Set when this is the user's first dashboard visit. */
  show: boolean;
  /** Server action that flips tour_completed_at on profiles. */
  completeAction: () => Promise<void>;
  /** First name (or fallback) for the greeting. */
  displayName: string | null;
};

type Tile = {
  icon: ReactNode;
  title: string;
  /** Why this piece of data matters for the forecast. */
  body: string;
};

// Framed around the data, not the features: each tile explains one number
// the user gives us and exactly how it moves their forecast.
const TILES: Tile[] = [
  {
    icon: (
      <path d="M3 18l5-6 4 4 7-9M14 7h6v6" />
    ),
    title: "A forecast, not a surprise",
    body: "Give us a few real numbers and Taxottic projects your full-year tax the moment anything changes. Here is why each one matters.",
  },
  {
    icon: (
      <path d="M12 3v14m0 0l-4-4m4 4l4-4M4 21h16" />
    ),
    title: "Your income sets the baseline",
    body: "From what you earn, we estimate your total tax and split it into four quarterly payments, so you always know what to set aside and April is never a shock.",
  },
  {
    icon: (
      <path d="M20 12V8a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h8m2 0l3 3m-3-3v-3m0 3h3" />
    ),
    title: "Every expense lowers the bill",
    body: "Log expenses as they happen and we fold them straight into the forecast, then surface the deductions you are entitled to but would have missed.",
  },
  {
    icon: (
      <>
        <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9L2.2 10a3.7 3.7 0 00-.2 1.2V16c0 .6.4 1 1 1h2" />
        <circle cx="7" cy="17" r="2" />
        <path d="M9 17h6" />
        <circle cx="17" cy="17" r="2" />
      </>
    ),
    title: "Miles turn into money",
    body: "Business miles are worth 72.5 cents each in 2026. Track your drives and we convert them into a deduction on your forecast automatically.",
  },
  {
    icon: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </>
    ),
    title: "Receipts file themselves",
    body: "Snap a photo and we read the merchant, amount, and date, then attach it to the right expense. The more real data you add, the sharper your forecast.",
  },
];

export function WelcomeTour({ show, completeAction, displayName }: Props) {
  const [open, setOpen] = useState(show);
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(false);
  const touchX = useRef<number | null>(null);
  const last = TILES.length - 1;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the OS motion preference once on mount (not available during SSR)
    setReduced(
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  function next() {
    if (index < last) setIndex(index + 1);
    else finish();
  }

  function finish() {
    setOpen(false);
    completeAction().catch(() => {});
  }

  function onTouchStart(e: React.TouchEvent) {
    touchX.current = e.touches[0]?.clientX ?? null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX.current;
    if (Math.abs(dx) > 45) {
      if (dx < 0) next();
      else setIndex((i) => Math.max(0, i - 1));
    }
    touchX.current = null;
  }

  if (!open) return null;
  const onLast = index === last;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Taxottic"
      className="fixed inset-0 z-[55] grid place-items-center px-4"
    >
      <div className="absolute inset-0 bg-forest-900/55 backdrop-blur-md" />
      <div className="relative max-w-md w-full">
        <div className="card p-7 sm:p-9 overflow-hidden">
          <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
            {index === 0 && displayName
              ? `Welcome, ${displayName}`
              : `${index + 1} of ${TILES.length}`}
          </div>

          {/* Sliding track. Swipe on touch; translateX animates between
              tiles (instant when the user prefers reduced motion). */}
          <div
            className="mt-4 overflow-hidden"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div
              className={
                "flex " + (reduced ? "" : "transition-transform duration-300 ease-out")
              }
              style={{ transform: `translateX(-${index * 100}%)` }}
            >
              {TILES.map((tile, i) => (
                <div
                  key={i}
                  className="w-full shrink-0"
                  aria-hidden={i !== index}
                >
                  <div className="min-h-[248px] sm:min-h-[236px] flex flex-col">
                    <span
                      aria-hidden="true"
                      className="grid place-items-center size-12 rounded-2xl bg-forest-900 text-gold-400"
                    >
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        {tile.icon}
                      </svg>
                    </span>
                    <h2 className="display mt-4 text-2xl sm:text-[1.7rem] text-forest-900 leading-tight text-balance">
                      {tile.title}
                    </h2>
                    <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
                      {tile.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Progress pips */}
          <div className="mt-5 flex items-center gap-1.5">
            {TILES.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => setIndex(i)}
                className={
                  "h-1 rounded-full transition-all " +
                  (i === index
                    ? "w-8 bg-gold-500"
                    : "w-1.5 bg-forest-100 hover:bg-gold-300")
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
              Skip
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
                {onLast ? "Start" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
