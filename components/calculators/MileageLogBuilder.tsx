"use client";

import Link from "next/link";
import { useState } from "react";
import { formatCents } from "@/lib/tax/forecast";
import {
  buildMileageLog,
  mileageLogToCsv,
  type LogTrip,
} from "@/lib/calculators/mileage-log";

/**
 * Turn typed trips into an IRS-shaped mileage log, in the browser.
 *
 * Nothing is uploaded and nothing is stored. That is a feature rather
 * than a limitation: this is a page a stranger lands on from a search
 * for "mileage log template", and asking them to hand over a year of
 * their movements to see a table would be both a worse tool and a worse
 * trade. The CSV is generated from a Blob on the client.
 *
 * The tool flags thin rows and never repairs them. See
 * lib/calculators/mileage-log.ts for why that line matters.
 */

const TAX_YEAR = 2026;

const BLANK: LogTrip = { date: "", purpose: "", from: "", to: "", miles: 0 };

export function MileageLogBuilder() {
  const [trips, setTrips] = useState<LogTrip[]>([{ ...BLANK }, { ...BLANK }, { ...BLANK }]);

  // Only rows with something in them count. Three empty starter rows
  // should not report themselves as three problems.
  const entered = trips.filter(
    (t) => t.date || t.purpose.trim() || t.from.trim() || t.to.trim() || t.miles > 0,
  );
  const summary = buildMileageLog(entered, TAX_YEAR);
  const hasRows = entered.length > 0;

  function update(i: number, patch: Partial<LogTrip>) {
    setTrips((prev) => prev.map((t, j) => (i === j ? { ...t, ...patch } : t)));
  }

  function addRow() {
    setTrips((prev) => [...prev, { ...BLANK }]);
  }

  function removeRow(i: number) {
    setTrips((prev) =>
      prev.length === 1 ? [{ ...BLANK }] : prev.filter((_, j) => j !== i),
    );
  }

  function downloadCsv() {
    const csv = mileageLogToCsv(summary);
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `mileage-log-${TAX_YEAR}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-6">
      <div className="card p-5 sm:p-6 overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm border-separate border-spacing-y-1">
          <caption className="sr-only">
            Your business trips for {TAX_YEAR}
          </caption>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.16em] text-gold-700">
              <th scope="col" className="font-medium px-2 pb-1">Date</th>
              <th scope="col" className="font-medium px-2 pb-1">Business purpose</th>
              <th scope="col" className="font-medium px-2 pb-1">From</th>
              <th scope="col" className="font-medium px-2 pb-1">To</th>
              <th scope="col" className="font-medium px-2 pb-1 text-right whitespace-nowrap">
                Miles
              </th>
              {/*
                whitespace-nowrap because the letter-spacing on these
                uppercase labels made "Deduction" wrap to "DEDUCTIO / N"
                at the column's natural width.
              */}
              <th scope="col" className="font-medium px-2 pb-1 text-right whitespace-nowrap">
                Deduction
              </th>
              <th scope="col" className="px-2 pb-1">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {trips.map((t, i) => {
              // Match this input row to its computed row, if it has one.
              const idx = entered.indexOf(t);
              const row = idx === -1 ? null : summary.rows[idx];
              return (
                <tr key={i} className="align-top">
                  <td className="px-1">
                    <input
                      type="date"
                      value={t.date}
                      onChange={(e) => update(i, { date: e.target.value })}
                      aria-label={`Trip ${i + 1} date`}
                      className="input py-2"
                    />
                  </td>
                  <td className="px-1">
                    <input
                      value={t.purpose}
                      onChange={(e) => update(i, { purpose: e.target.value })}
                      placeholder="Client meeting, Acme quarterly review"
                      aria-label={`Trip ${i + 1} business purpose`}
                      className="input py-2"
                    />
                  </td>
                  <td className="px-1">
                    <input
                      value={t.from}
                      onChange={(e) => update(i, { from: e.target.value })}
                      placeholder="Office"
                      aria-label={`Trip ${i + 1} start`}
                      className="input py-2"
                    />
                  </td>
                  <td className="px-1">
                    <input
                      value={t.to}
                      onChange={(e) => update(i, { to: e.target.value })}
                      placeholder="Client site"
                      aria-label={`Trip ${i + 1} destination`}
                      className="input py-2"
                    />
                  </td>
                  <td className="px-1">
                    <input
                      inputMode="decimal"
                      value={t.miles || ""}
                      onChange={(e) =>
                        update(i, {
                          miles: parseFloat(
                            e.target.value.replace(/[^0-9.]/g, ""),
                          ) || 0,
                        })
                      }
                      placeholder="18.4"
                      aria-label={`Trip ${i + 1} miles`}
                      className="input py-2 text-right"
                    />
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums text-forest-900 whitespace-nowrap">
                    {row && row.deductionCents > 0
                      ? formatCents(row.deductionCents)
                      : "-"}
                    {row && row.miles > 0 ? (
                      <span className="block text-[11px] text-ink-muted">
                        {row.centsPerMile}¢/mile
                      </span>
                    ) : null}
                  </td>
                  <td className="px-1 py-3">
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      aria-label={`Remove trip ${i + 1}`}
                      className="text-ink-muted hover:text-forest-900 text-lg leading-none px-1"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <button
          type="button"
          onClick={addRow}
          className="mt-3 inline-flex items-center justify-center h-10 px-4 rounded-[0.625rem] border border-gold-300/40 text-sm text-forest-800 hover:bg-cream/70 transition-colors"
        >
          Add a trip
        </button>
      </div>

      <div className="grid sm:grid-cols-[1fr_auto] gap-4 items-start">
        <div className="card p-5 sm:p-6">
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
            Your log so far
          </div>
          <div className="mt-1 display text-3xl sm:text-4xl text-forest-900">
            {formatCents(summary.totalDeductionCents)}
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {summary.totalMiles.toLocaleString("en-US")} business miles across{" "}
            {summary.rows.length}{" "}
            {summary.rows.length === 1 ? "trip" : "trips"} in {TAX_YEAR}
          </p>

          {summary.incompleteCount > 0 ? (
            <div className="mt-4 rounded-xl border border-gold-300/60 bg-cream/70 px-4 py-3">
              <p className="text-sm font-medium text-forest-800">
                {summary.incompleteCount}{" "}
                {summary.incompleteCount === 1 ? "trip needs" : "trips need"}{" "}
                more detail
              </p>
              <ul className="mt-2 grid gap-1 text-xs text-ink-soft">
                {summary.rows.flatMap((r, i) =>
                  r.issues.map((issue) => (
                    <li key={`${i}-${issue}`}>
                      Trip {i + 1}: {issue}
                    </li>
                  )),
                )}
              </ul>
              <p className="mt-2 text-xs text-ink-muted">
                Nothing has been filled in for you. A log that invents the
                missing parts is not a record, and it is the reconstructed
                figure that gets disallowed.
              </p>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={downloadCsv}
          disabled={!hasRows}
          className="inline-flex items-center justify-center h-11 px-5 rounded-[0.625rem] bg-forest-900 text-cream text-sm font-semibold hover:bg-forest-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          Download CSV
        </button>
      </div>

      <div className="rounded-2xl bg-forest-900 text-cream p-6">
        <p className="text-sm leading-relaxed">
          Typing this out once a year is the part that fails.{" "}
          <span className="text-gold-300">
            Taxottic writes the log as you drive
          </span>
          , by GPS, with the date, the route and a map already attached, so
          the record exists before anyone asks for it.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-flex items-center justify-center h-11 px-5 rounded-[0.625rem] bg-gold-300 text-forest-900 text-sm font-semibold hover:bg-gold-200 transition-colors"
        >
          Keep my log automatically, free →
        </Link>
      </div>
    </div>
  );
}
