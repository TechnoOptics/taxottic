"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { forecast, formatCents, type ForecastInput } from "@/lib/tax/forecast";
import type { FilingStatus } from "@/lib/tax/constants-2025";

/** Inputs the page reads from ?income=…&expenses=…&filing=…&state=…&w2=…
 *  so a shared link opens a pre-filled, already-computed calculator. */
export type SETaxInitial = {
  income?: string;
  expenses?: string;
  filing?: FilingStatus;
  state?: string;
  w2?: string;
};

/**
 * Public, no-login self-employment tax calculator.
 *
 * The whole point: it runs the EXACT SAME forecast engine the paid app
 * uses (`lib/tax/forecast.ts` — a pure function, safe client-side), so
 * the free tool a stranger finds via "self-employment tax calculator"
 * gives the same IRS-aligned math (SE tax, QBI, brackets, quarterly
 * estimates) they'd get inside Taxottic. That accuracy is the wedge:
 * most calculators that rank today only do the flat 15.3% SE-tax slice
 * and ignore income tax, QBI, and the W-2 Social-Security-wage-base
 * interaction. This one doesn't.
 *
 * It exposes only the handful of inputs a first-time visitor can
 * answer, and fills the rest of ForecastInput with neutral defaults.
 */

// Current planning year. Matches the app default; constants exist for
// 2025 + 2026 (lib/tax/constants.ts). Bump when a new year ships.
const TAX_YEAR = 2026;

const FILING_STATUSES: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_filing_jointly", label: "Married filing jointly" },
  { value: "married_filing_separately", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_widow", label: "Qualifying surviving spouse" },
];

// 50 states + DC. The engine returns ~0 for the no-income-tax states
// (AK, FL, NV, SD, TX, WA, WY + TN/NH on earned income), so those are
// correct without special-casing. "" = skip state (federal only).
const STATES: { code: string; name: string }[] = [
  { code: "", name: "Skip state (federal only)" },
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

function toCents(dollars: number): number {
  return Math.round((Number.isFinite(dollars) ? dollars : 0) * 100);
}

/** Neutral ForecastInput — everything the visitor didn't tell us is 0
 *  or off, so the number reflects self-employment income alone. */
function baseInput(): ForecastInput {
  return {
    taxYear: TAX_YEAR,
    filingStatus: "single",
    stateCode: null,
    age: null,
    isBlind: false,
    itemize: false,
    dependents: 0,
    dependentsUnder17: 0,
    spouseIncomeCents: 0,
    estimatedPaymentsCents: 0,
    ownerW2WagesCents: 0,
    ownerW2WithheldCents: 0,
    ownerW2SsWagesCents: 0,
    spouseW2WagesCents: 0,
    spouseW2WithheldCents: 0,
    spouseW2SsWagesCents: 0,
    entityType: "self_employed_1099",
    ytdIncomeCents: 0,
    ytdBusinessExpensesCents: 0,
    ytdMealsCents: 0,
    ytdAboveTheLineCents: 0,
    ytdItemizedCents: 0,
    autoMileageCents: 0,
    autoHomeOfficeCents: 0,
    // 12 months entered = the amounts ARE the full-year figures, so the
    // engine's annualization is a no-op and projected == entered.
    monthsEntered: 12,
  };
}

export function SelfEmploymentTaxCalculator({
  showFullQuarterlySchedule = false,
  initial,
}: {
  /** When true, the result shows all four quarterly payments + due
   *  dates instead of just the next one — used by the quarterly-
   *  estimated-tax calculator page, where the schedule IS the point. */
  showFullQuarterlySchedule?: boolean;
  /** Pre-fill values from the URL (a shared link). */
  initial?: SETaxInitial;
} = {}) {
  const [income, setIncome] = useState(initial?.income ?? "");
  const [expenses, setExpenses] = useState(initial?.expenses ?? "");
  const [filingStatus, setFilingStatus] = useState<FilingStatus>(
    initial?.filing ?? "single",
  );
  const [stateCode, setStateCode] = useState(initial?.state ?? "");
  const [hasW2, setHasW2] = useState(!!initial?.w2);
  const [w2Wages, setW2Wages] = useState(initial?.w2 ?? "");
  const [copied, setCopied] = useState(false);

  const grossNum = parseFloat(income) || 0;
  const expensesNum = parseFloat(expenses) || 0;
  const netNum = Math.max(0, grossNum - expensesNum);
  const hasEntered = income.trim() !== "" && grossNum > 0;

  const result = useMemo(() => {
    if (!hasEntered) return null;
    const w2 = hasW2 ? toCents(parseFloat(w2Wages) || 0) : 0;
    const input: ForecastInput = {
      ...baseInput(),
      filingStatus,
      stateCode: stateCode || null,
      ytdIncomeCents: toCents(grossNum),
      ytdBusinessExpensesCents: toCents(expensesNum),
      ownerW2WagesCents: w2,
      // Assume the W-2 wages were all Social-Security-taxable and that a
      // typical ~11% was already withheld — a reasonable default so the
      // "already paid" side isn't wildly off. Users refine inside the app.
      ownerW2SsWagesCents: w2,
      ownerW2WithheldCents: Math.round(w2 * 0.11),
    };
    return forecast(input);
  }, [hasEntered, grossNum, expensesNum, filingStatus, stateCode, hasW2, w2Wages]);

  const nextQuarter = result?.quarterlyEstimates.find(
    (q) => !q.isPast && q.amountCents > 0,
  );

  // Keep the URL in sync with the inputs (no navigation) so the address
  // bar — and anything the user copies/shares — always reproduces the
  // current calculation with a matching OG preview. history.replaceState
  // avoids a Next.js navigation / server round-trip on every keystroke.
  const shareQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (income) p.set("income", income);
    if (expenses) p.set("expenses", expenses);
    if (filingStatus !== "single") p.set("filing", filingStatus);
    if (stateCode) p.set("state", stateCode);
    if (hasW2 && w2Wages) p.set("w2", w2Wages);
    return p.toString();
  }, [income, expenses, filingStatus, stateCode, hasW2, w2Wages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = shareQuery
      ? `${window.location.pathname}?${shareQuery}`
      : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [shareQuery]);

  async function share() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const shareData = {
      title: "Self-Employment Tax Calculator — Taxottic",
      text: result
        ? `My estimated self-employment tax: ${formatCents(result.totalTaxCents)}. Check yours free:`
        : "Free self-employment tax calculator:",
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      /* user cancelled the native sheet — fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — nothing more we can do gracefully */
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6 lg:gap-8 items-start">
      {/* ---- Inputs ---- */}
      <div className="card p-6 sm:p-7">
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
          Your numbers
        </div>
        <h2 className="display text-xl text-forest-900 mt-1">
          Tell us about your year
        </h2>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Self-employment income (gross, for the year)
            </span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                $
              </span>
              <input
                inputMode="decimal"
                value={income}
                onChange={(e) => setIncome(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="80,000"
                aria-label="Gross self-employment income for the year"
                className="input pl-7"
              />
            </div>
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Business expenses (for the year)
            </span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                $
              </span>
              <input
                inputMode="decimal"
                value={expenses}
                onChange={(e) =>
                  setExpenses(e.target.value.replace(/[^0-9.]/g, ""))
                }
                placeholder="12,000"
                aria-label="Business expenses for the year"
                className="input pl-7"
              />
            </div>
            <span className="text-xs text-ink-muted">
              Net self-employment profit:{" "}
              <span className="font-medium text-forest-800">
                {formatCents(toCents(netNum))}
              </span>
            </span>
          </label>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Filing status
              </span>
              <select
                value={filingStatus}
                onChange={(e) =>
                  setFilingStatus(e.target.value as FilingStatus)
                }
                aria-label="Filing status"
                className="input"
              >
                {FILING_STATUSES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">State</span>
              <select
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                aria-label="State"
                className="input"
              >
                {STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex items-start gap-2.5 text-sm text-forest-800 cursor-pointer">
            <input
              type="checkbox"
              checked={hasW2}
              onChange={(e) => setHasW2(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I also have a W-2 day job
              <span className="block text-xs text-ink-muted">
                Changes your Social Security wage base and bracket — worth
                including if you moonlight.
              </span>
            </span>
          </label>

          {hasW2 ? (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                W-2 wages (annual, box 1)
              </span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                  $
                </span>
                <input
                  inputMode="decimal"
                  value={w2Wages}
                  onChange={(e) =>
                    setW2Wages(e.target.value.replace(/[^0-9.]/g, ""))
                  }
                  placeholder="60,000"
                  aria-label="Annual W-2 wages"
                  className="input pl-7"
                />
              </div>
            </label>
          ) : null}
        </div>
      </div>

      {/* ---- Result ---- */}
      <div className="lg:sticky lg:top-6">
        {result ? (
          <div className="card p-6 sm:p-7 border-gold-300/60">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
                Estimated {TAX_YEAR} tax
              </div>
              <button
                type="button"
                onClick={share}
                className="shrink-0 -mt-1 inline-flex items-center gap-1.5 rounded-full border border-forest-100 px-3 py-1.5 text-xs font-medium text-forest-800 hover:bg-cream hover:border-gold-300 transition-colors"
                aria-label="Share this result"
              >
                {copied ? (
                  "Link copied"
                ) : (
                  <>
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
                    </svg>
                    Share
                  </>
                )}
              </button>
            </div>
            <div className="mt-1 flex items-baseline gap-3 flex-wrap">
              <span className="display text-4xl sm:text-5xl text-forest-900">
                {formatCents(result.totalTaxCents)}
              </span>
              <span className="text-sm text-ink-soft">
                ≈ {(result.effectiveRate * 100).toFixed(1)}% of income
              </span>
            </div>

            <dl className="mt-5 grid gap-2.5 text-sm">
              <Row
                label="Self-employment tax (15.3%)"
                value={formatCents(result.selfEmploymentTaxCents)}
              />
              <Row
                label="Federal income tax"
                value={formatCents(result.federalIncomeTaxCents)}
              />
              {result.stateTaxCents > 0 ? (
                <Row
                  label="State income tax"
                  value={formatCents(result.stateTaxCents)}
                />
              ) : null}
              {result.qbiDeductionCents > 0 ? (
                <Row
                  label="QBI deduction applied"
                  value={`− ${formatCents(result.qbiDeductionCents)}`}
                  positive
                />
              ) : null}
            </dl>

            {showFullQuarterlySchedule ? (
              <div className="mt-5 rounded-xl bg-cream/70 border border-gold-300/50 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
                  Your {TAX_YEAR} quarterly payment schedule
                </div>
                <ul className="mt-2 grid gap-1.5">
                  {result.quarterlyEstimates.map((q) => (
                    <li
                      key={q.quarter}
                      className={
                        "flex items-baseline justify-between gap-3 text-sm " +
                        (q.isPast ? "opacity-55" : "")
                      }
                    >
                      <span className="text-ink-soft">
                        Q{q.quarter} · due{" "}
                        {new Date(q.dueDate + "T00:00:00").toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" },
                        )}
                        {q.isPast ? " (passed)" : ""}
                      </span>
                      <span className="tabular-nums font-medium text-forest-900">
                        {formatCents(Math.max(0, q.amountCents))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : nextQuarter ? (
              <div className="mt-5 rounded-xl bg-cream/70 border border-gold-300/50 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
                  Next quarterly payment
                </div>
                <div className="mt-0.5 text-forest-900">
                  <span className="display text-lg">
                    {formatCents(nextQuarter.amountCents)}
                  </span>{" "}
                  <span className="text-sm text-ink-soft">
                    due{" "}
                    {new Date(
                      nextQuarter.dueDate + "T00:00:00",
                    ).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="mt-6 rounded-xl bg-forest-900 text-cream px-5 py-4">
              <div className="text-sm leading-relaxed text-cream/90">
                This is a snapshot. Taxottic keeps this forecast{" "}
                <span className="text-gold-300 font-medium">live all year</span>
                , synced to your bank — so the number is always current and
                you&rsquo;re never surprised in April.
              </div>
              <Link
                href="/login?intent=signup"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gold-400 px-5 py-2.5 text-sm font-semibold text-forest-950 hover:bg-gold-300 transition-colors"
              >
                Track it automatically — free →
              </Link>
            </div>

            <p className="mt-4 text-[11px] text-ink-muted leading-relaxed">
              Estimate only, for planning. Uses {TAX_YEAR} federal rules and
              your state&rsquo;s brackets. Not tax advice or a substitute for a
              licensed CPA. Your figures stay in your browser — nothing is
              sent anywhere.
            </p>
          </div>
        ) : (
          <div className="card p-6 sm:p-7 grid place-items-center text-center min-h-[280px]">
            <div>
              <div className="text-4xl" aria-hidden="true">
                🧮
              </div>
              <p className="mt-3 text-sm text-ink-soft max-w-xs">
                Enter your self-employment income to see your estimated
                federal + state tax, self-employment tax, and quarterly
                payments — instantly.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd
        className={
          "tabular-nums font-medium " +
          (positive ? "text-emerald-700" : "text-forest-900")
        }
      >
        {value}
      </dd>
    </div>
  );
}
