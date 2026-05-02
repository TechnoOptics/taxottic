"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BellaChat } from "./BellaChat";

type Props = {
  companyId?: string;
  /** When false (free plan), the panel renders an upgrade card
   *  instead of the live chat. We still render the FAB so users can
   *  discover the feature. */
  enabled?: boolean;
};

/**
 * Floating "Ask Bella" button + collapsible chat panel. Sits in the bottom-
 * right corner. Click to summon the panel; click again (or tap X) to
 * collapse. Animated gold conic gradient ring for the premium feel.
 */
export function BellaFAB({ companyId, enabled = true }: Props) {
  const [open, setOpen] = useState(false);

  // Collapse with Escape, like a modal.
  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open]);

  return (
    <>
      {/* Backdrop ONLY on mobile so the panel feels modal there. Desktop
          keeps the panel as a side drawer with no backdrop dim. */}
      {open ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 bg-forest-900/15 backdrop-blur-[2px] z-30 sm:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      {/* Chat panel: bottom-right anchored, floats above content */}
      {open ? (
        <div
          role="dialog"
          aria-label="Ask Bella"
          className="fixed z-40 right-3 sm:right-6 bottom-3 sm:bottom-24 w-[calc(100vw-1.5rem)] sm:w-[400px] max-h-[78dvh] sm:max-h-[600px] flex flex-col"
          style={{
            bottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <div className="card flex flex-col flex-1 min-h-0 shadow-2xl shadow-forest-900/25 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-forest-100 bg-cream/60">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
                  Bella
                </div>
                <div className="display text-lg text-forest-900 leading-none mt-0.5">
                  Your tax guide
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close Bella"
                className="size-8 rounded-full grid place-items-center text-ink-soft hover:bg-cream hover:text-forest-900"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round">
                  <path d="M3 3 L13 13 M13 3 L3 13" />
                </svg>
              </button>
            </div>
            <div className="flex-1 min-h-0 p-4 overflow-y-auto">
              {enabled ? (
                <BellaChat companyPublicId={companyId} compact />
              ) : (
                <div className="grid gap-3 max-w-sm mx-auto pt-4 text-center">
                  <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
                    Pro feature
                  </div>
                  <h3 className="display text-xl text-forest-900">
                    Ask Bella any tax question.
                  </h3>
                  <p className="text-sm text-ink-soft leading-relaxed">
                    Bella reads your forecast, knows the IRC sections
                    and IRS publications, and answers in plain English
                    without billable hours. Pro unlocks unlimited
                    questions; free is read-only access to the rest of
                    the app.
                  </p>
                  <Link
                    href="/billing?reason=bella"
                    className="btn-primary text-sm mt-1"
                  >
                    See Pro plans
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* The FAB itself */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close Bella" : "Ask Bella"}
        aria-expanded={open}
        className="bella-fab fixed z-40 right-4 sm:right-6 size-14 sm:size-16 rounded-full grid place-items-center select-none active:translate-y-[1px] transition-transform"
        style={{
          bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <span className="bella-fab-inner display text-2xl sm:text-3xl font-semibold leading-none">
          {open ? (
            <svg viewBox="0 0 16 16" width="20" height="20" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round">
              <path d="M3 3 L13 13 M13 3 L3 13" />
            </svg>
          ) : (
            "B"
          )}
        </span>
      </button>
    </>
  );
}
