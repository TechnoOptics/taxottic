"use client";

import { useState } from "react";
import { openLocationSettings } from "@/lib/mileage/native-tracker";

type Props = {
  reason: string;
  recoverable: number;
  /** Server action (bound) that reconstructs approximate trips. */
  recoverAction: (formData: FormData) => Promise<void>;
};

/**
 * Amber warning shown on the Mileage screen when the tracking-health
 * detector sees the "stops logged, drives missing" signature. Gives the
 * fix (set Location to Always), a one-tap Open-Settings button, and an
 * opt-in "recover approximate drives" action for the miles already lost.
 */
export function TrackingHealthBanner({ reason, recoverable, recoverAction }: Props) {
  const [opening, setOpening] = useState(false);

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50/60 p-4 text-amber-900">
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5">
          ⚠
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-sm">Your drives aren&rsquo;t being recorded</p>
          <p className="mt-1 text-xs leading-relaxed">{reason}</p>
          <p className="mt-2 text-xs leading-relaxed">
            <b>Fix it:</b> set Taxottic&rsquo;s Location permission to{" "}
            <b>Always</b> (not &ldquo;While Using&rdquo;) with <b>Precise</b> on, allow{" "}
            <b>Motion &amp; Fitness</b>, and turn off Low Power Mode while driving.
            Then toggle tracking off and back on.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                setOpening(true);
                try {
                  await openLocationSettings();
                } finally {
                  setOpening(false);
                }
              }}
              className="btn-primary text-xs py-1.5 px-3"
            >
              {opening ? "Opening…" : "Open location settings"}
            </button>
            {recoverable > 0 ? (
              <form action={recoverAction}>
                <button
                  type="submit"
                  className="btn-ghost text-xs py-1.5 px-3"
                  title="Creates approximate, unclassified trips (straight-line distance) from your recorded stops for you to review."
                >
                  Recover {recoverable} approximate drive
                  {recoverable === 1 ? "" : "s"}
                </button>
              </form>
            ) : null}
          </div>
          {recoverable > 0 ? (
            <p className="mt-2 text-[11px] text-amber-800/80 leading-snug">
              Recovered drives are approximate (straight-line, likely an
              under-count) and start <b>unclassified</b> with no deduction —
              review and classify each one before claiming.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
