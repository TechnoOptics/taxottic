/**
 * The first figure on Today. Spec 4.3 item 3.
 *
 * The quarters come from the forecast's quarterly estimates, whose
 * amountCents already nets W-2 withholding and the estimated payments the
 * user recorded on their tax profile; "paid so far" is that recorded
 * total. The app records no separate set-aside ledger, so "still to pay"
 * is the sum of the quarters still ahead that owe money.
 */
export type Quarter = { quarter: 1 | 2 | 3 | 4; dueDate: string; amountCents: number; isPast: boolean };

const DAY_MS = 86_400_000;

export function nextPaymentSummary(input: { quarters: Quarter[]; paidSoFarCents: number; asOf: Date }) {
  const ahead = [...input.quarters].filter((q) => !q.isPast).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const owed = ahead.filter((q) => q.amountCents > 0);
  const first = owed[0] ?? null;
  const stillToPayCents = owed.reduce((a, q) => a + q.amountCents, 0);
  const paidSoFarCents = Math.max(0, input.paidSoFarCents);
  const total = paidSoFarCents + stillToPayCents;
  const next = first
    ? {
        quarter: first.quarter,
        dueDate: first.dueDate,
        daysUntil: Math.max(0, Math.round((Date.parse(`${first.dueDate}T00:00:00Z`) - Date.UTC(input.asOf.getUTCFullYear(), input.asOf.getUTCMonth(), input.asOf.getUTCDate())) / DAY_MS)),
        amountCents: first.amountCents,
      }
    : null;
  return { next, paidSoFarCents, stillToPayCents, progress: total > 0 ? paidSoFarCents / total : 0 };
}
