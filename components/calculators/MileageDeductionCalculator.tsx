"use client";

import Link from "next/link";
import { CarIcon } from "@/components/ui/Icons";
import { useState } from "react";
import { formatCents } from "@/lib/tax/forecast";
import { getTaxYearConstants } from "@/lib/tax/constants";
import { useCalcShare, ShareButton } from "@/components/calculators/CalcShare";
import { priceMilesByPeriod } from "@/lib/calculators/mileage-reimbursement";
import { parseRateParam } from "@/lib/calculators/rate-param";

/**
 * Public, no-login business-mileage deduction calculator.
 *
 * The "tax savings" line multiplies the deduction by a combined marginal
 * rate the visitor picks, labelled as an estimate, because the true
 * saving depends on their full return (which is what the app computes
 * precisely). The DEDUCTION itself is exact.
 *
 * SPLIT-RATE YEARS ARE THE WHOLE COMPLICATION HERE.
 *
 * This used to read MILEAGE_RATE_PER_MILE_CENTS, a single number, with a
 * comment claiming it was "pulled from the same constants the app uses,
 * so it's never stale". It was stale anyway, because 2026 does not have
 * one rate. The IRS raised the business standard rate mid-year: 72.5
 * cents applies Jan 1 to Jun 30 (Notice 2026-10) and 76 cents applies
 * from Jul 1. MILEAGE_RATE_PER_MILE_CENTS is only the FIRST period.
 *
 * Measured impact before this change: every mile driven on or after
 * Jul 1 was valued 3.5 cents low, so a driver entering 10,000 second-half
 * miles was told $7,250 when the correct figure is $7,600. The app's own
 * engine has always been right (lib/mileage/deduction.ts prices each
 * drive by its date via mileageRateCentsForDate); only this public
 * calculator was wrong, which is the worst place for it to be wrong.
 *
 * So the input is split by period, which is also how the IRS expects a
 * split-rate year to be reported. Periods are DERIVED from
 * MILEAGE_RATE_PERIODS, so a future single-rate year collapses to one
 * field automatically and a future split year picks up its own dates
 * with no edit here.
 */

const TAX_YEAR = 2026;

const YEAR_CONSTANTS = getTaxYearConstants(TAX_YEAR);

/**
 * One entry per rate in force during the tax year, already labelled for
 * display. A single-rate year yields exactly one entry and the UI
 * renders a single unlabelled miles field, identical to before.
 */
const RATE_PERIODS: { fromIso: string; centsPerMile: number; label: string }[] =
  (YEAR_CONSTANTS.MILEAGE_RATE_PERIODS ?? [
    {
      fromIso: `${TAX_YEAR}-01-01`,
      centsPerMile: YEAR_CONSTANTS.MILEAGE_RATE_PER_MILE_CENTS,
    },
  ]).map((p, i, all) => {
    const start = new Date(`${p.fromIso}T00:00:00Z`);
    const endIso = all[i + 1]?.fromIso;
    const end = endIso
      ? new Date(new Date(`${endIso}T00:00:00Z`).getTime() - 86_400_000)
      : new Date(`${TAX_YEAR}-12-31T00:00:00Z`);
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    return { ...p, label: `${fmt(start)} to ${fmt(end)}` };
  });

const IS_SPLIT_YEAR = RATE_PERIODS.length > 1;

/** Lowest and highest rate in force, for the copy that summarises them. */
const RATE_CENTS = RATE_PERIODS[0].centsPerMile;
const RATE_CENTS_LATEST = RATE_PERIODS[RATE_PERIODS.length - 1].centsPerMile;

// Combined marginal-rate presets. The self-employed default reflects
// that a mileage deduction lowers BOTH self-employment tax (~14.1% net
// of the half-SE deduction) AND income tax, so ~30% combined is a fair
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
  // `miles` is the first rate period, `miles2` the second, and so on.
  // Numbered rather than date-keyed so a shared link stays readable and
  // survives the IRS changing the split dates.
  initial?: { miles?: string; miles2?: string; rate?: string };
} = {}) {
  // One miles value per rate period. `initial.miles` stays the first
  // period so links shared before the split existed still resolve to a
  // sensible, and now correctly priced, figure rather than 404ing on a
  // renamed param.
  const [milesByPeriod, setMilesByPeriod] = useState<string[]>(() =>
    RATE_PERIODS.map(
      (_, i) => (i === 0 ? initial?.miles : i === 1 ? initial?.miles2 : "") ?? "",
    ),
  );
  const [rate, setRate] = useState(
    parseRateParam(initial?.rate, 0.3),
  );

  const setPeriodMiles = (i: number, v: string) =>
    setMilesByPeriod((prev) => prev.map((x, j) => (i === j ? v : x)));

  const perPeriod = milesByPeriod.map(
    (m) => parseFloat(m.replace(/,/g, "")) || 0,
  );
  const milesNum = perPeriod.reduce((a, b) => a + b, 0);
  const hasEntered = milesNum > 0;

  // Price each period at ITS rate and sum, rather than applying one rate
  // to the total. In a split year those differ, and the whole point of
  // this calculator is that the deduction figure is exact.
  //
  // Deliberately not memoised: it is a couple of multiplications over a
  // two-element array, so useMemo would cost more than it saves, and
  // keying it on a derived array meant fabricating a dependency string.
  const deductionCents = priceMilesByPeriod(perPeriod, RATE_PERIODS);
  const savingsCents = Math.round(deductionCents * rate);

  const { share, copied } = useCalcShare(
    {
      miles: milesByPeriod[0] || undefined,
      ...(IS_SPLIT_YEAR && milesByPeriod[1]
        ? { miles2: milesByPeriod[1] }
        : {}),
      rate: String(rate),
    },
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
          {RATE_PERIODS.map((p, i) => (
            <label key={p.fromIso} className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                {IS_SPLIT_YEAR
                  ? `Business miles driven ${p.label}`
                  : "Business miles driven (for the year)"}
                {IS_SPLIT_YEAR ? (
                  <span className="ml-1.5 font-normal text-ink-muted">
                    at {p.centsPerMile}¢/mile
                  </span>
                ) : null}
              </span>
              <input
                inputMode="decimal"
                value={milesByPeriod[i]}
                onChange={(e) =>
                  setPeriodMiles(i, e.target.value.replace(/[^0-9.]/g, ""))
                }
                placeholder={IS_SPLIT_YEAR ? "6,000" : "12,000"}
                aria-label={
                  IS_SPLIT_YEAR
                    ? `Business miles driven ${p.label} at ${p.centsPerMile} cents per mile`
                    : "Business miles driven this year"
                }
                className="input"
              />
              {i === RATE_PERIODS.length - 1 ? (
                <span className="text-xs text-ink-muted">
                  Only the miles driven for work count, commuting to a regular
                  workplace doesn&rsquo;t.
                </span>
              ) : null}
            </label>
          ))}

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
            {TAX_YEAR} IRS standard mileage rate:{" "}
            <span className="font-medium text-forest-800">
              {IS_SPLIT_YEAR
                ? `${RATE_CENTS}¢ / mile through ${RATE_PERIODS[0].label.split(" to ")[1]}, then ${RATE_CENTS_LATEST}¢ / mile`
                : `${RATE_CENTS}¢ / mile`}
            </span>
            {IS_SPLIT_YEAR ? (
              <span className="block mt-1 text-xs text-ink-muted">
                The IRS raised the rate mid-year, so {TAX_YEAR} miles are
                deducted at two different rates depending on when you drove
                them.
              </span>
            ) : null}
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
              {IS_SPLIT_YEAR ? (
                <>
                  {RATE_PERIODS.map((p, i) =>
                    perPeriod[i] > 0 ? (
                      <span key={p.fromIso} className="block">
                        {perPeriod[i].toLocaleString("en-US")} miles ×{" "}
                        {p.centsPerMile}¢/mile ({p.label})
                      </span>
                    ) : null,
                  )}
                  <span className="block mt-1">
                    {milesNum.toLocaleString("en-US")} business miles in total
                  </span>
                </>
              ) : (
                <>
                  {milesNum.toLocaleString("en-US")} business miles ×{" "}
                  {RATE_CENTS}¢/mile
                </>
              )}
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
                in the background as you drive, an IRS-ready log, no notebook,
                folded straight into your live tax forecast.
              </div>
              <Link
                href="/login?intent=signup"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gold-400 px-5 py-2.5 text-sm font-semibold text-forest-950 hover:bg-gold-300 transition-colors"
              >
                Track my miles automatically, free →
              </Link>
            </div>

            <p className="mt-4 text-[11px] text-ink-muted leading-relaxed">
              The deduction is exact ({TAX_YEAR} IRS rate). The savings figure
              is an estimate, your real saving depends on your full return.
              Estimate only, not tax advice. Nothing is stored; your numbers
              stay in your browser.
            </p>
          </div>
        ) : (
          <div className="card p-6 sm:p-7 grid place-items-center text-center min-h-[240px]">
            <div>
              <CarIcon className="size-9 mx-auto text-gold-700" />
              <p className="mt-3 text-sm text-ink-soft max-w-xs">
                Enter your business miles to see your deduction and roughly what
                it saves you, instantly.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
