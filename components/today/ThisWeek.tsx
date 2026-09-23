import { LedgerRow } from "@/components/ui/Rows";

/**
 * Spec 4.3 item 5.
 *
 * `scope` names whose ledger this is when it is not simply the reader's
 * own: the owner's week is their managed company's, and saying so is the
 * difference between "this week" and "this week, at Northwind Co.".
 */
export function ThisWeek({ rows, scope }: { rows: { date: string; text: string; amount: string }[]; scope?: string }) {
  return (
    <section className="today-section" aria-labelledby="today-week">
      <h2 id="today-week" className="today-section-title">
        This week
        {scope ? <span className="mono-label today-scope"> · {scope}</span> : null}
      </h2>
      {rows.length === 0 ? (
        <p className="today-empty">Nothing moved the number this week.</p>
      ) : (
        <div className="today-ledger">
          {rows.map((r, i) => (
            <LedgerRow key={`${r.date}-${r.text}-${i}`} date={r.date} text={r.text} amount={r.amount} />
          ))}
        </div>
      )}
    </section>
  );
}
