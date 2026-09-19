import { TodayHeader } from "./TodayHeader";
import { TodaySpine } from "./TodaySpine";
import { NextPaymentPanel } from "./NextPaymentPanel";
import { NeedsYourCall } from "./NeedsYourCall";
import { ThisWeek } from "./ThisWeek";
import { YearToDate } from "./YearToDate";

const AS_OF = new Date("2026-09-19T12:00:00Z");

const SUMMARY = {
  next: { quarter: 3 as const, dueDate: "2026-09-15", daysUntil: 10, amountCents: 342000 },
  paidSoFarCents: 215000,
  stillToPayCents: 342000,
  progress: 215000 / 557000,
};

const CALL_ITEMS = [
  { kind: "bank_transaction" as const, id: "t1", title: "Sweetgreen", subtitle: "Sep 2 · $24.50 · Meal with a client?", href: "/c/abc/banks?tx=t1", publicId: "abc" },
  { kind: "csv_transaction" as const, id: "r1", title: "Delta 4821", subtitle: "Sep 1 · $612.40", href: "/c/abc/import/i1?highlight=r1" },
];

const WEEK_ROWS = [
  { date: "Sep 4", text: "Drive, 22.7 mi", amount: "-$16" },
  { date: "Sep 3", text: "Adobe Creative Cloud", amount: "-$22" },
  { date: "Sep 2", text: "Invoice paid, Northwind Co.", amount: "+$410" },
];

const YTD_ROWS = [
  { label: "Software", amountCents: 250000, fraction: 1 },
  { label: "Advertising", amountCents: 124000, fraction: 0.496 },
  { label: "Travel", amountCents: 86000, fraction: 0.344 },
  { label: "Uncategorised", amountCents: 5000, fraction: 0.02 },
];

/**
 * The Today composition, mounted with fixture data instead of a live
 * session. The dashboard this mirrors (app/dashboard/page.tsx) cannot be
 * signed into by an agent, so this stands in for it in the component
 * test harness for Task 8's owner screenshots. Every value here is
 * illustrative, taken from the components' own CT specs (NextPaymentPanel,
 * NeedsYourCall) and lib/today's unit tests (week, categories), not from
 * live data.
 *
 * `theme` is applied to the wrapper's own `data-theme` attribute; the
 * caller is still responsible for setting `document.documentElement
 * .dataset.theme`, the way every other Today CT spec sets the theme the
 * app's tokens actually resolve against.
 */
export function TodayFixture({ width, theme }: { width: number; theme: "light" | "dark" }) {
  return (
    <div data-skin="instrument" data-grammar="year" data-theme={theme} style={{ width, padding: 16 }}>
      <TodayHeader asOf={AS_OF} taxYear={2026} syncedAt={new Date("2026-09-19T11:52:00Z")} />
      <TodaySpine taxYear={2026} asOf={AS_OF} tickNotes={["Q1 · past", "Q2 · past", "Q3 · due", "Q4"]} />
      <NextPaymentPanel summary={SUMMARY} federalCents={276000} stateCents={66000} forecastHref="/personal/forecast" note="Includes Northwind Co." />
      <NeedsYourCall items={CALL_ITEMS} count={CALL_ITEMS.length} />
      <ThisWeek rows={WEEK_ROWS} />
      <YearToDate rows={YTD_ROWS} href="/personal/expenses" />
    </div>
  );
}
