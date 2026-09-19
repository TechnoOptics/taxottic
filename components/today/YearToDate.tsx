import Link from "next/link";
import { CategoryBar } from "@/components/ui/Rows";
import { formatCents } from "@/lib/tax/engine/money";

/** Spec 4.3 item 6. */
export function YearToDate({ rows, href }: { rows: { label: string; amountCents: number; fraction: number }[]; href: string }) {
  return (
    <section className="today-section" aria-labelledby="today-ytd">
      <h2 id="today-ytd" className="today-section-title">Year to date</h2>
      {rows.length === 0 ? (
        <p className="today-empty">No deductions logged yet this year.</p>
      ) : (
        <div className="today-bars">
          {rows.map((r) => (
            <CategoryBar key={r.label} label={r.label} amount={formatCents(r.amountCents)} fraction={r.fraction} />
          ))}
        </div>
      )}
      <Link href={href} className="btn-quiet today-link min-h-11">All deductions</Link>
    </section>
  );
}
