import Link from "next/link";
import { formatCents } from "@/lib/tax/engine/money";
import { StatRow } from "@/components/ui/Rows";
import type { nextPaymentSummary } from "@/lib/today/next-payment";

type Summary = ReturnType<typeof nextPaymentSummary>;

/**
 * Spec 4.3 item 3: the live figure first, in brass, then what is paid and
 * what remains.
 *
 * `note` names what the figure includes when it is not the filer alone,
 * e.g. a sole proprietorship folded into the personal return. Without it
 * a combined figure and a personal-only one look identical.
 */
export function NextPaymentPanel({ summary, federalCents, stateCents, forecastHref, note }: { summary: Summary; federalCents: number; stateCents: number; forecastHref: string; note?: string }) {
  const n = summary.next;
  const heading = n
    ? `Q${n.quarter} · due ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${n.dueDate}T00:00:00Z`))} · ${n.daysUntil} day${n.daysUntil === 1 ? "" : "s"}`
    : "No payment due";
  return (
    <section className="today-panel" aria-labelledby="today-next-payment-label">
      <div className="today-lead">
        <div>
          <div id="today-next-payment-label" className="today-lead-label">Next payment</div>
          <div className="mono-label today-lead-note">{heading}</div>
        </div>
        <div id="today-next-payment" className="figure today-lead-figure">{n ? formatCents(n.amountCents) : formatCents(0)}</div>
      </div>
      <p className="today-split">
        Federal <span className="figure">{formatCents(federalCents)}</span> and state <span className="figure">{formatCents(stateCents)}</span> for the year.
      </p>
      {note ? <p className="today-note">{note}</p> : null}
      <div className="today-rows">
        <StatRow label="Paid so far" value={formatCents(summary.paidSoFarCents)} />
        <StatRow label="Still to pay" value={formatCents(summary.stillToPayCents)} />
      </div>
      <div className="today-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(summary.progress * 100)} aria-label="Paid so far against the year">
        <i style={{ width: `${Math.round(summary.progress * 1000) / 10}%` }} />
      </div>
      <Link href={forecastHref} className="btn-quiet today-link">Open the forecast</Link>
    </section>
  );
}
