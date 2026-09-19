import { TodayHeader } from "./TodayHeader";
import { TodaySpine } from "./TodaySpine";
import { NextPaymentPanel } from "./NextPaymentPanel";
import { NeedsYourCall } from "./NeedsYourCall";
import { ThisWeek } from "./ThisWeek";
import { YearToDate } from "./YearToDate";
import { nextPaymentSummary, type Quarter } from "@/lib/today/next-payment";
import { spineNotes } from "@/lib/today/spine-notes";

const AS_OF = new Date("2026-09-19T12:00:00Z");

/**
 * One set of quarters feeds both the spine's tick notes and the panel's
 * figure, through the same two functions the dashboard uses. Hand-written
 * values drifted: the panel said Q3 was due in 10 days while AS_OF was
 * already four days past the Q3 date the spine was drawing.
 */
const QUARTERS: Quarter[] = [
  { quarter: 1, dueDate: "2026-04-15", amountCents: 0, isPast: true },
  { quarter: 2, dueDate: "2026-06-15", amountCents: 0, isPast: true },
  { quarter: 3, dueDate: "2026-09-15", amountCents: 0, isPast: true },
  { quarter: 4, dueDate: "2027-01-15", amountCents: 342000, isPast: false },
];
const SUMMARY = nextPaymentSummary({ quarters: QUARTERS, paidSoFarCents: 215000, asOf: AS_OF });
const TICK_NOTES = spineNotes({ quarters: QUARTERS, doneDueDates: [] });

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
  { label: "Uncategorized", amountCents: 5000, fraction: 0.02 },
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
      <TodaySpine taxYear={2026} asOf={AS_OF} tickNotes={TICK_NOTES} />
      <NextPaymentPanel summary={SUMMARY} federalCents={276000} stateCents={66000} forecastHref="/personal/forecast" note="Includes Northwind Co." />
      <NeedsYourCall items={CALL_ITEMS} count={CALL_ITEMS.length} />
      <ThisWeek rows={WEEK_ROWS} />
      <YearToDate rows={YTD_ROWS} href="/personal/expenses" />
    </div>
  );
}
