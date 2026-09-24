"use client";

import Link from "next/link";
import { ChartIcon } from "@/components/ui/Icons";
import { useMemo, useState } from "react";
import { forecast, formatCents, type ForecastInput } from "@/lib/tax/forecast";
import type { FilingStatus } from "@/lib/tax/constants-2025";
import { getTaxYearConstants } from "@/lib/tax/constants";
import {
  neutralForecastInput,
  toCents,
  FILING_STATUS_OPTIONS,
  US_STATES,
} from "@/lib/calculators/base-input";
import { useCalcShare, ShareButton } from "@/components/calculators/CalcShare";

/**
 * Effective tax rate calculator, the general-audience tool.
 *
 * Unlike the self-employment calculators, this one accepts W-2 salary
 * OR self-employment income, and its headline is the effective rate
 * (total tax ÷ income) alongside the marginal federal bracket. Answers
 * the very common "what's my actual tax rate?" search for employees,
 * not just the self-employed. Same verified engine underneath.
 */

const TAX_YEAR = 2026;

function marginalFederalRate(
  taxableCents: number,
  filingStatus: FilingStatus,
): number {
  const brackets = getTaxYearConstants(TAX_YEAR).FEDERAL_BRACKETS[filingStatus];
  let rate = 0;
  for (const b of brackets) {
    rate = b.rate;
    if (b.upTo != null && taxableCents <= b.upTo) break;
  }
  return rate;
}

export function EffectiveTaxRateCalculator({
  initial,
}: {
  initial?: {
    income?: string;
    type?: "w2" | "self";
    filing?: FilingStatus;
    state?: string;
  };
} = {}) {
  const [income, setIncome] = useState(initial?.income ?? "");
  const [incomeType, setIncomeType] = useState<"w2" | "self">(
    initial?.type ?? "w2",
  );
  const [filingStatus, setFilingStatus] = useState<FilingStatus>(
    initial?.filing ?? "single",
  );
  const [stateCode, setStateCode] = useState(initial?.state ?? "");

  const grossNum = parseFloat(income) || 0;
  const hasEntered = income.trim() !== "" && grossNum > 0;

  const result = useMemo(() => {
    if (!hasEntered) return null;
    const cents = toCents(grossNum);
    const base = neutralForecastInput(TAX_YEAR, filingStatus);
    const input: ForecastInput =
      incomeType === "self"
        ? { ...base, stateCode: stateCode || null, ytdIncomeCents: cents }
        : {
            ...base,
            stateCode: stateCode || null,
            ytdIncomeCents: 0,
            ownerW2WagesCents: cents,
            ownerW2SsWagesCents: cents,
          };
    const r = forecast(input);
    return {
      totalTaxCents: r.totalTaxCents,
      // Engine's overallEffectiveRate (total tax ÷ total gross income)
      // now handles W-2 + mixed income correctly, so the local workaround
      // this replaced is gone.
      effectiveRate: r.overallEffectiveRate,
      marginalRate: marginalFederalRate(r.taxableIncomeCents, filingStatus),
      afterTaxCents: cents - r.totalTaxCents,
    };
  }, [hasEntered, grossNum, incomeType, filingStatus, stateCode]);

  const { share, copied } = useCalcShare(
    {
      income,
      type: incomeType !== "w2" ? incomeType : undefined,
      filing: filingStatus !== "single" ? filingStatus : undefined,
      state: stateCode || undefined,
    },
    () =>
      result
        ? `My effective tax rate: ${(result.effectiveRate * 100).toFixed(1)}%. Check yours free:`
        : "Free effective tax rate calculator:",
  );

  return (
    <div className="grid lg:grid-cols-2 gap-6 lg:gap-8 items-start">
      <div className="card p-6 sm:p-7">
        <div className="mono-label">Your income</div>
        <h2 className="display text-xl text-forest-900 mt-1">
          What do you earn?
        </h2>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Annual income (before tax)
            </span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                $
              </span>
              <input
                inputMode="decimal"
                value={income}
                onChange={(e) =>
                  setIncome(e.target.value.replace(/[^0-9.]/g, ""))
                }
                placeholder="75,000"
                aria-label="Annual income before tax"
                className="input pl-7"
              />
            </div>
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Income type
            </span>
            <select
              value={incomeType}
              onChange={(e) => setIncomeType(e.target.value as "w2" | "self")}
              aria-label="Income type"
              className="input"
            >
              <option value="w2">W-2 salary / wages</option>
              <option value="self">Self-employment / 1099 (net)</option>
            </select>
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
                {FILING_STATUS_OPTIONS.map((f) => (
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
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="lg:sticky lg:top-6">
        {result ? (
          <div className="card p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <div className="mono-label">Effective tax rate</div>
              <ShareButton onShare={share} copied={copied} />
            </div>
            <div className="mt-1 figure font-medium text-5xl sm:text-6xl text-forest-900">
              {(result.effectiveRate * 100).toFixed(1)}%
            </div>

            <dl className="mt-5 grid gap-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-soft">Marginal federal bracket</dt>
                <dd className="figure font-medium text-forest-900">
                  {(result.marginalRate * 100).toFixed(0)}%
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-soft">Total estimated tax</dt>
                <dd className="figure font-medium text-forest-900">
                  {formatCents(result.totalTaxCents)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-soft">After-tax income</dt>
                <dd className="figure font-medium text-emerald-700">
                  {formatCents(result.afterTaxCents)}
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-sm text-ink-soft leading-relaxed">
              Your <strong className="text-forest-800">effective rate</strong>{" "}
              is what you actually pay across all your income. Your{" "}
              <strong className="text-forest-800">marginal rate</strong> is what
              the next dollar you earn is taxed at, always higher, and the one
              that matters for decisions like a raise or an extra contract.
            </p>

            <div className="mt-6 border-t border-edge pt-5">
              <p className="text-sm leading-relaxed text-ink-soft">
                Self-employed or side-hustling? Taxottic keeps this{" "}
                <strong className="font-medium text-forest-900">
                  live all year
                </strong>{" "}
                and finds the deductions that lower it.
              </p>
              <Link href="/login?intent=signup" className="btn-primary mt-3">
                Start free
              </Link>
            </div>

            <p className="mt-4 text-[11px] text-ink-muted leading-relaxed">
              Estimate using {TAX_YEAR} federal + state rules and the standard
              deduction. Not tax advice. Your figures stay in your browser.
            </p>
          </div>
        ) : (
          <div className="card p-6 sm:p-7 grid place-items-center text-center min-h-[240px]">
            <div>
              <ChartIcon className="size-9 mx-auto text-ink-muted" />
              <p className="mt-3 text-sm text-ink-soft max-w-xs">
                Enter your income to see your real effective tax rate, your
                marginal bracket, and your after-tax take-home.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
