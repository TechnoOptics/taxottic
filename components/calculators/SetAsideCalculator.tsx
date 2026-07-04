"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { forecast, formatCents, type ForecastInput } from "@/lib/tax/forecast";
import type { FilingStatus } from "@/lib/tax/constants-2025";
import {
  neutralForecastInput,
  toCents,
  FILING_STATUS_OPTIONS,
  US_STATES,
} from "@/lib/calculators/base-input";
import { useCalcShare, ShareButton } from "@/components/calculators/CalcShare";

/**
 * "How much should I set aside for taxes?" calculator.
 *
 * Same verified forecast engine as the other tools, but the OUTPUT is
 * reframed as an action: the single percentage of every payment a
 * self-employed person should move to savings, plus dollars per $1,000
 * earned. That's what people actually search for and act on, a rule
 * they can apply to each invoice, not a year-end tax bill.
 */

const TAX_YEAR = 2026;

export function SetAsideCalculator({
  initial,
}: {
  initial?: {
    income?: string;
    expenses?: string;
    filing?: FilingStatus;
    state?: string;
  };
} = {}) {
  const [income, setIncome] = useState(initial?.income ?? "");
  const [expenses, setExpenses] = useState(initial?.expenses ?? "");
  const [filingStatus, setFilingStatus] = useState<FilingStatus>(
    initial?.filing ?? "single",
  );
  const [stateCode, setStateCode] = useState(initial?.state ?? "");

  const grossNum = parseFloat(income) || 0;
  const expensesNum = parseFloat(expenses) || 0;
  const hasEntered = income.trim() !== "" && grossNum > 0;

  const result = useMemo(() => {
    if (!hasEntered) return null;
    const input: ForecastInput = {
      ...neutralForecastInput(TAX_YEAR, filingStatus),
      stateCode: stateCode || null,
      ytdIncomeCents: toCents(grossNum),
      ytdBusinessExpensesCents: toCents(expensesNum),
    };
    const r = forecast(input);
    // Set-aside % is of GROSS income, that's the number you apply to
    // each payment as it lands, before you've subtracted expenses.
    const pct = grossNum > 0 ? r.totalTaxCents / toCents(grossNum) : 0;
    return {
      totalTaxCents: r.totalTaxCents,
      pct,
      perThousandCents: Math.round(pct * 100000), // $ per $1,000
    };
  }, [hasEntered, grossNum, expensesNum, filingStatus, stateCode]);

  const { share, copied } = useCalcShare(
    {
      income,
      expenses,
      filing: filingStatus !== "single" ? filingStatus : undefined,
      state: stateCode || undefined,
    },
    () =>
      result
        ? `I set aside ${(result.pct * 100).toFixed(0)}% of every payment for taxes. Find your number free:`
        : "Free tax set-aside calculator:",
  );

  return (
    <div className="grid lg:grid-cols-2 gap-6 lg:gap-8 items-start">
      <div className="card p-6 sm:p-7">
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
          Your year
        </div>
        <h2 className="display text-xl text-forest-900 mt-1">
          What are you making?
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
                onChange={(e) =>
                  setIncome(e.target.value.replace(/[^0-9.]/g, ""))
                }
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
          <div className="card p-6 sm:p-7 border-gold-300/60">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
                Set aside
              </div>
              <ShareButton onShare={share} copied={copied} />
            </div>
            <div className="mt-1 flex items-baseline gap-3 flex-wrap">
              <span className="display text-5xl sm:text-6xl text-forest-900">
                {(result.pct * 100).toFixed(0)}%
              </span>
              <span className="text-sm text-ink-soft">of every payment</span>
            </div>
            <p className="mt-2 text-sm text-ink-soft">
              That&rsquo;s{" "}
              <span className="font-medium text-forest-800">
                {formatCents(result.perThousandCents)} for every $1,000
              </span>{" "}
              you get paid, about{" "}
              <span className="font-medium text-forest-800">
                {formatCents(result.totalTaxCents)}
              </span>{" "}
              across the whole year.
            </p>

            <div className="mt-6 rounded-xl bg-forest-900 text-cream px-5 py-4">
              <div className="text-sm leading-relaxed text-cream/90">
                A percentage is a guess that drifts as your income changes.
                Taxottic keeps the number{" "}
                <span className="text-gold-300 font-medium">exact and live</span>
                , synced to your bank, so you set aside the right amount, not a
                rule of thumb.
              </div>
              <Link
                href="/login?intent=signup"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gold-400 px-5 py-2.5 text-sm font-semibold text-forest-950 hover:bg-gold-300 transition-colors"
              >
                Get my exact number, free →
              </Link>
            </div>

            <p className="mt-4 text-[11px] text-ink-muted leading-relaxed">
              Estimate for planning, using {TAX_YEAR} federal + state rules.
              Covers self-employment tax and income tax. Not tax advice. Your
              figures stay in your browser, nothing is sent anywhere.
            </p>
          </div>
        ) : (
          <div className="card p-6 sm:p-7 grid place-items-center text-center min-h-[240px]">
            <div>
              <div className="text-4xl" aria-hidden="true">
                🏦
              </div>
              <p className="mt-3 text-sm text-ink-soft max-w-xs">
                Enter your income to see the percentage of each payment to move
                into savings, so April is never a surprise.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
