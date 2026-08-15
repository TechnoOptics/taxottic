"use client";

import Link from "next/link";
import { useState } from "react";
import { CarIcon } from "@/components/ui/Icons";
import { formatCents } from "@/lib/tax/forecast";
import { calculateReimbursement } from "@/lib/calculators/mileage-reimbursement";
import { useCalcShare, ShareButton } from "@/components/calculators/CalcShare";
import { parseRateParam } from "@/lib/calculators/rate-param";

/**
 * Team mileage reimbursement, for an employer rather than a filer.
 *
 * Every other calculator on the site answers a personal-tax question.
 * This one answers "what does reimbursing my team cost me", which is the
 * first tax question a small business with drivers actually has, and it
 * is the one surface where the product's mileage capture is the answer
 * rather than a feature.
 *
 * All arithmetic lives in lib/calculators/mileage-reimbursement.ts so it
 * can be tested without a DOM. This file is presentation only.
 */

const TAX_YEAR = 2026;

// Entity-level marginal rates. A C-corp pays a flat 21%; a pass-through
// owner deducts against personal marginal rates, so the common brackets
// are offered rather than a single guess.
const RATE_PRESETS: { value: number; label: string }[] = [
  { value: 0.21, label: "C-corp (21% flat)" },
  { value: 0.24, label: "Pass-through owner, 24% bracket" },
  { value: 0.32, label: "Pass-through owner, 32% bracket" },
  { value: 0.37, label: "Pass-through owner, 37% bracket" },
  { value: 0.12, label: "Pass-through owner, 12% bracket" },
  { value: 0.22, label: "Pass-through owner, 22% bracket" },
];

export function MileageReimbursementCalculator({
  initial,
}: {
  initial?: { drivers?: string; miles?: string; rate?: string };
} = {}) {
  const [drivers, setDrivers] = useState(initial?.drivers ?? "");
  const [miles, setMiles] = useState(initial?.miles ?? "");
  const [rate, setRate] = useState(
    parseRateParam(initial?.rate, 0.21),
  );

  const driversNum = parseFloat(drivers.replace(/,/g, "")) || 0;
  const milesNum = parseFloat(miles.replace(/,/g, "")) || 0;
  const hasEntered = driversNum > 0 && milesNum > 0;

  const r = calculateReimbursement({
    drivers: driversNum,
    milesPerDriverPerMonth: milesNum,
    taxYear: TAX_YEAR,
    marginalRate: rate,
  });

  const { share, copied } = useCalcShare(
    {
      drivers: drivers || undefined,
      miles: miles || undefined,
      rate: String(rate),
    },
    () =>
      hasEntered
        ? `Reimbursing my team's business miles: ${formatCents(r.totalCents)} a year. Work out yours free:`
        : "Free team mileage reimbursement calculator:",
  );

  return (
    <div className="grid lg:grid-cols-2 gap-6 lg:gap-8 items-start">
      <div className="card p-6 sm:p-7">
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
          Your team
        </div>
        <h2 className="display text-xl text-forest-900 mt-1">
          Who drives, and how far?
        </h2>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Employees who drive for work
            </span>
            <input
              inputMode="numeric"
              value={drivers}
              onChange={(e) => setDrivers(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="5"
              aria-label="Number of employees who drive for work"
              className="input"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Business miles each, per month
            </span>
            <input
              inputMode="decimal"
              value={miles}
              onChange={(e) => setMiles(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="400"
              aria-label="Business miles per employee per month"
              className="input"
            />
            <span className="text-xs text-ink-muted">
              Work driving only. An employee&rsquo;s commute between home and
              their regular workplace is not reimbursable at the standard
              rate.
            </span>
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              How the business is taxed (for the savings estimate)
            </span>
            <select
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              aria-label="Business marginal tax rate"
              className="input"
            >
              {RATE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-xl bg-cream/70 border border-gold-300/40 px-4 py-3 text-sm text-ink-soft">
            {TAX_YEAR} IRS standard mileage rate:{" "}
            <span className="font-medium text-forest-800">
              {r.isSplitYear
                ? r.periods
                    .map((p) => `${p.centsPerMile}¢ (${p.label})`)
                    .join(", ")
                : `${r.periods[0].centsPerMile}¢ / mile`}
            </span>
            {r.isSplitYear ? (
              <span className="block mt-1 text-xs text-ink-muted">
                The IRS raised the rate mid-year, so each half is priced
                separately.
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
                Reimbursement for the year
              </div>
              <ShareButton onShare={share} copied={copied} />
            </div>
            <div className="mt-1 display text-4xl sm:text-5xl text-forest-900">
              {formatCents(r.totalCents)}
            </div>
            <p className="mt-2 text-sm text-ink-soft">
              {r.periods.map((p) => (
                <span key={p.label} className="block">
                  {p.miles.toLocaleString("en-US")} miles × {p.centsPerMile}
                  ¢/mile ({p.label})
                </span>
              ))}
              <span className="block mt-1">
                {r.annualMilesTotal.toLocaleString("en-US")} business miles
                across {driversNum.toLocaleString("en-US")}{" "}
                {driversNum === 1 ? "driver" : "drivers"}
              </span>
            </p>

            <dl className="mt-5 grid gap-2">
              <div className="flex items-baseline justify-between gap-3 rounded-xl bg-cream/70 border border-gold-300/50 px-4 py-3">
                <dt className="text-sm text-ink-soft">Per driver, per year</dt>
                <dd className="display text-lg text-forest-900 tabular-nums">
                  {formatCents(r.perDriverCents)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 rounded-xl bg-cream/70 border border-gold-300/50 px-4 py-3">
                <dt className="text-sm text-ink-soft">
                  Tax saved (it&rsquo;s deductible)
                </dt>
                <dd className="display text-lg text-forest-900 tabular-nums">
                  {formatCents(r.taxSavedCents)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 rounded-xl border border-gold-300/60 px-4 py-3">
                <dt className="text-sm font-medium text-forest-800">
                  Net cost after tax
                </dt>
                <dd className="display text-xl text-forest-900 tabular-nums">
                  {formatCents(r.netCostCents)}
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-xs text-ink-muted leading-relaxed">
              Paid under an accountable plan at or below the IRS standard
              rate, this is deductible to the business and is not taxable
              wages to the employee, so there is no payroll tax on it. The
              tax-saved figure is an estimate at the rate you picked; your
              actual saving depends on the full return.
            </p>
          </div>
        ) : (
          <div className="card p-8 text-center">
            <CarIcon className="size-9 mx-auto text-gold-700" />
            <p className="mt-3 text-sm text-ink-soft">
              Enter how many people drive and roughly how far, and this will
              price a year of reimbursement at the IRS standard rate.
            </p>
          </div>
        )}

        <div className="mt-4 rounded-2xl bg-forest-900 text-cream p-6">
          <p className="text-sm leading-relaxed">
            <span className="text-gold-300">
              Taxottic captures those miles for you
            </span>{" "}
            in the background, per driver, with a map and an IRS-ready log,
            so the number above comes from what actually happened rather
            than from what someone remembered.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-flex items-center justify-center h-11 px-5 rounded-[0.625rem] bg-gold-300 text-forest-900 text-sm font-semibold hover:bg-gold-200 transition-colors"
          >
            Track my team&rsquo;s miles, free →
          </Link>
        </div>
      </div>
    </div>
  );
}
