import { formatCents } from "@/lib/tax/engine/money";

const DAY_MS = 86_400_000;

function monthDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

/** Signed, whole-dollar figure: expenses and drives negative, income positive. */
function signed(cents: number, sign: "-" | "+"): string {
  const whole = formatCents(Math.abs(cents));
  if (whole === "$0") return "$0";
  return `${sign}${whole}`;
}

/** The last seven days of what moved the number, newest first. Spec 4.3 item 5. */
export function weekLedger(input: {
  expenses: { createdAt: string; amountCents: number; label: string }[];
  trips: { endedAt: string; miles: number; deductionCents: number; classification: string | null }[];
  applied: { appliedAt: string; amountCents: number; label: string }[];
  asOf: Date;
  maxRows?: number;
}) {
  const floor = input.asOf.getTime() - 7 * DAY_MS;
  const rows: { date: string; text: string; amount: string; sortKey: number }[] = [];
  for (const e of input.expenses) {
    const t = Date.parse(e.createdAt);
    if (t >= floor) rows.push({ date: monthDay(e.createdAt), text: e.label, amount: signed(e.amountCents, "-"), sortKey: t });
  }
  for (const d of input.trips) {
    const t = Date.parse(d.endedAt);
    if (t >= floor && d.classification === "business")
      rows.push({ date: monthDay(d.endedAt), text: `Drive, ${d.miles.toFixed(1)} mi`, amount: signed(d.deductionCents, "-"), sortKey: t });
  }
  for (const a of input.applied) {
    const t = Date.parse(a.appliedAt);
    if (t >= floor) rows.push({ date: monthDay(a.appliedAt), text: a.label, amount: signed(a.amountCents, a.amountCents >= 0 ? "+" : "-"), sortKey: t });
  }
  rows.sort((a, b) => b.sortKey - a.sortKey);
  return rows.slice(0, input.maxRows ?? 7);
}
