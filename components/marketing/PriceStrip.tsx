import Link from "next/link";
import { PLAN_PRICING } from "@/lib/plans/limits";
import { formatCents } from "@/lib/tax/engine/money";

/** One line of pricing, from the same table /pricing renders. No new claims. */
export function PriceStrip() {
  const solo = formatCents(PLAN_PRICING.solo_monthly.amountCents);
  return (
    <section className="border-y border-edge-bright bg-[var(--surface)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
        <div>
          <p className="display text-xl sm:text-2xl text-foreground">
            Free to look around. Solo from <span className="figure">{solo}</span> a month.
          </p>
          <p className="mono-label mt-1.5">No card to start · Filer for W-2 only · Practice for firms</p>
        </div>
        <Link href="/pricing" className="btn-quiet shrink-0">
          See pricing
        </Link>
      </div>
    </section>
  );
}
