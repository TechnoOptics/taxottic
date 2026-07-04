"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCents } from "@/lib/tax/forecast";
import { getTaxYearConstants } from "@/lib/tax/constants";
import { useCalcShare, ShareButton } from "@/components/calculators/CalcShare";

/**
 * Public, no-login business-mileage deduction calculator.
 *
 * Core math is exact: business miles × the IRS standard mileage rate
 * for the year (pulled from the same constants the app uses, so it's
 * never stale). The "tax savings" line multiplies the deduction by a
 * combined marginal rate the visitor picks — labelled as an estimate,
 * because the true saving depends on their full return (which is what
 * the app computes precisely).
 */

const TAX_YEAR = 2026;
const RATE_CENTS = getTaxYearConstants(TAX_YEAR).MILEAGE_RATE_PER_MILE_CENTS;

// Combined marginal-rate presets. The self-employed default reflects
// that a mileage deduction lowers BOTH self-employment tax (~14.1% net
// of the half-SE deduction) AND income tax — so ~30% combined is a fair
// middle estimate. Employees deducting via an employer plan just use
// their income bracket.
const RATE_PRESETS: { value: number; label: string }[] = [
  { value: 0.3, label: "Self-employed (SE + income tax, ~30%)" },
  { value: 0.12, label: "12% income tax bracket" },
  { value: 0.22, label: "22% income tax bracket" },
  { value: 0.24, label: "24% income tax bracket" },
  { value: 0.32, label: "32% income tax bracket" },
  { value: 0.37, label: "37% income tax bracket" },
];

export function MileageDeductionCalculator({
  initial,
}: {
  initial?: { miles?: string; rate?: string };
} = {}) {
  const [miles, setMiles] = useState(initial?.miles ?? "");
  const [rate, setRate] = useState(
    initial?.rate ? parseFloat(initial.rate) : 0.3,
  );

  const milesNum = parseFloat(miles.replace(/,/g, "")) || 0;
  const hasEntered = miles.trim() !== "" && milesNum > 0;

  const { deductionCents, savingsCents } = useMemo(() => {
    const d = Math.round(milesNum * RATE_CENTS);
    return { deductionCents: d, savingsCents: Math.round(d * rate) };
  }, [milesNum, rate]);

  const { share, copied } = useCalcShare(
    { miles: miles || undefined, rate: String(rate) },
    () =>
      hasEntered
        ? `My business mileage deduction: ${formatCents(deductionCents)}. Calculate yours free:`
        : "Free mileage deduction calculator:",
  );

  return (
    <div className="grid lg:grid-cols-2 gap-6 lg:gap-8 items-start">
      <div className="card p-6 sm:p-7">
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
          Your driving
        </div>
        <h2 className="display text-xl text-forest-900 mt-1">
          How many business miles?
        </h2>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Business miles driven (for the year)
            </span>
            <input
              inputMode="decimal"
              value={miles}
              onChange={(e) => setMiles(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="12,000"
              aria-label="Business miles driven this year"
              className="input"
            />
            <span className="text-xs text-ink-muted">
              Only the miles driven for work count — commuting to a regular
              workplace doesn&rsquo;t.
            </span>
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Your tax situation (for the savings estimate)
            </span>
            <select
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              aria-label="Combined marginal tax rate"
              className="input"
            >
              {RATE_PRESETS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-xl bg-cream/70 border border-gold-300/40 px-4 py-3 text-sm text-ink-soft">
            2026 IRS standard mileage rate:{" "}
            <span className="font-medium text-forest-800">
              {RATE_CENTS}¢ / mile
            </span>
          </div>
        </div>
      </div>

      <div className="lg:sticky lg:top-6">
        {hasEntered ? (
          <div className="card p-6 sm:p-7 border-gold-300/60">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
                Your mileage deduction
              </div>
              <ShareButton onShare={share} copied={copied} />
            </div>
            <div className="mt-1 display text-4xl sm:text-5xl text-forest-900">
              {formatCents(deductionCents)}
            </div>
            <p className="mt-2 text-sm text-ink-soft">
              {milesNum.toLocaleString()} business miles ×{" "}
              {RATE_CENTS}¢/mile
            </p>

            <div className="mt-5 rounded-xl bg-cream/70 border border-gold-300/50 px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
                Estimated tax savings
              </div>
              <div className="mt-0.5 text-forest-900">
                <span className="display text-lg">
                  ≈ {formatCents(savingsCents)}
                </span>{" "}
                <span className="text-sm text-ink-soft">
                  off your tax bill at {(rate * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div className="mt-6 rounded-xl bg-forest-900 text-cream px-5 py-4">
              <div className="text-sm leading-relaxed text-cream/90">
                Taxottic{" "}
                <span className="text-gold-300 font-medium">
                  logs these miles for you automatically
                </span>{" "}
                in the background as you drive — an IRS-ready log, no notebook,
                folded straight into your live tax forecast.
              </div>
              <Link
                href="/login?intent=signup"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gold-400 px-5 py-2.5 text-sm font-semibold text-forest-950 hover:bg-gold-300 transition-colors"
              >
                Track my miles automatically — free →
              </Link>
            </div>

            <p className="mt-4 text-[11px] text-ink-muted leading-relaxed">
              The deduction is exact ({TAX_YEAR} IRS rate). The savings figure
              is an estimate — your real saving depends on your full return.
              Estimate only, not tax advice. Nothing is stored; your numbers
              stay in your browser.
            </p>
          </div>
        ) : (
          <div className="card p-6 sm:p-7 grid place-items-center text-center min-h-[240px]">
            <div>
              <div className="text-4xl" aria-hidden="true">
                🚗
              </div>
              <p className="mt-3 text-sm text-ink-soft max-w-xs">
                Enter your business miles to see your deduction and roughly what
                it saves you — instantly.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
