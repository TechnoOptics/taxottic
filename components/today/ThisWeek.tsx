import { LedgerRow } from "@/components/ui/Rows";

/** Spec 4.3 item 5. */
export function ThisWeek({ rows }: { rows: { date: string; text: string; amount: string }[] }) {
  return (
    <section className="today-section" aria-labelledby="today-week">
      <h2 id="today-week" className="today-section-title">This week</h2>
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
