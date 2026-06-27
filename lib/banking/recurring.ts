import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Auto-detect recurring expense streams (software subscriptions, SaaS,
 * any fixed monthly/quarterly cost) from a company's synced expenses and
 * mark them so the forecast projects them instead of treating each charge
 * as one-off.
 *
 * Why the "anchor only the latest occurrence" rule matters:
 *   The forecast's recurrence expansion (lib/tax/recurrence) projects a
 *   "monthly" row from ITS month through December. If we marked all six
 *   of an Adobe-$90 stream (months 1-6) "monthly", each would re-project
 *   forward and the year would be wildly over-counted. Instead we mark
 *   exactly ONE anchor — the latest occurrence — "monthly", and leave the
 *   earlier ones "one_off" (they're real past charges). Net effect:
 *   actuals for the months already seen + a forward projection from the
 *   latest month. Re-running each sync simply walks the anchor forward as
 *   new months arrive. Idempotent.
 *
 * Grouping key = category + whole-dollar amount. A fixed subscription
 * bills the same amount in the same category each period; variable-amount
 * charges (e.g. usage-based AWS) won't group and stay one_off — which is
 * the safe outcome (we don't invent a fixed projection for a variable
 * cost). Conservative threshold: a stream must appear in >= 3 distinct
 * months before we call it recurring.
 */

export type ExpenseRowForRecurrence = {
  id: string;
  month: number; // 1-12
  amount_cents: number;
  category_code: string | null;
  recurrence: string | null;
};

export type RecurrenceValue =
  | "one_off"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual";
export type RecurrenceUpdate = { id: string; recurrence: RecurrenceValue };

/** Minimum distinct months a stream must span to count as recurring. */
export const MIN_RECURRING_MONTHS = 3;

function dollarBucket(cents: number): number {
  return Math.round(Math.abs(cents) / 100);
}

/** Sorted distinct months whose every consecutive gap is exactly 3 →
 *  quarterly; anything else (incl. the dense monthly case) → monthly. */
function inferCadence(sortedMonths: number[]): "monthly" | "quarterly" {
  for (let i = 1; i < sortedMonths.length; i++) {
    if (sortedMonths[i] - sortedMonths[i - 1] !== 3) return "monthly";
  }
  return "quarterly";
}

/**
 * Pure core: given a company's expense rows, return only the recurrence
 * CHANGES needed (rows already at the right value are omitted).
 */
export function computeRecurrenceUpdates(
  rows: ExpenseRowForRecurrence[],
): RecurrenceUpdate[] {
  const groups = new Map<string, ExpenseRowForRecurrence[]>();
  for (const r of rows) {
    const key = `${r.category_code ?? "_"}|${dollarBucket(r.amount_cents)}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  const updates: RecurrenceUpdate[] = [];
  for (const group of groups.values()) {
    const distinctMonths = [...new Set(group.map((r) => r.month))].sort(
      (a, b) => a - b,
    );
    const want = new Map<string, RecurrenceValue>();
    if (distinctMonths.length >= MIN_RECURRING_MONTHS) {
      const cadence = inferCadence(distinctMonths);
      // Anchor = single latest-month row (ties broken by id for stability).
      const anchor = group.reduce((a, b) =>
        b.month > a.month || (b.month === a.month && b.id > a.id) ? b : a,
      );
      for (const r of group) {
        want.set(r.id, r.id === anchor.id ? cadence : "one_off");
      }
    } else {
      // Too few to be recurring — ensure none are left marked recurring.
      for (const r of group) want.set(r.id, "one_off");
    }
    for (const r of group) {
      const target = want.get(r.id)!;
      const current = (r.recurrence ?? "one_off") as RecurrenceValue;
      if (target !== current) updates.push({ id: r.id, recurrence: target });
    }
  }
  return updates;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Persist a set of recurrence changes to `table`, batching by target value
 * (≤5 distinct values) and id-chunk so we issue a few bounded statements.
 */
async function persistRecurrenceUpdates(
  admin: SupabaseClient,
  table: "monthly_income" | "monthly_expenses",
  updates: RecurrenceUpdate[],
): Promise<number> {
  if (updates.length === 0) return 0;
  const byValue = new Map<RecurrenceValue, string[]>();
  for (const u of updates) {
    const ids = byValue.get(u.recurrence) ?? [];
    ids.push(u.id);
    byValue.set(u.recurrence, ids);
  }
  for (const [value, ids] of byValue) {
    for (const ids100 of chunk(ids, 100)) {
      const { error } = await admin
        .from(table)
        .update({ recurrence: value })
        .in("id", ids100);
      if (error) console.error(`[recurring] ${table} update failed`, error.message);
    }
  }
  return updates.length;
}

/**
 * Run the detector against a company's expenses for a tax year and
 * persist the recurrence changes. Returns the number of rows updated.
 * Safe to call after every sync — it's idempotent.
 */
export async function applyRecurringExpenseDetection(
  admin: SupabaseClient,
  companyId: string,
  taxYear: number,
): Promise<number> {
  const { data: rows, error } = await admin
    .from("monthly_expenses")
    .select("id, month, amount_cents, category_code, recurrence")
    .eq("company_id", companyId)
    .eq("tax_year", taxYear);
  if (error) {
    console.error("[recurring] fetch failed", error.message);
    return 0;
  }
  if (!rows || rows.length === 0) return 0;

  const updates = computeRecurrenceUpdates(rows as ExpenseRowForRecurrence[]);
  return persistRecurrenceUpdates(admin, "monthly_expenses", updates);
}

// ---------------------------------------------------------------------------
// Income (subscription) recurrence anchoring
// ---------------------------------------------------------------------------
//
// Recurring REVENUE is different from recurring expenses in two ways:
//
//   1. Identity is known, not inferred. Stripe subscription charges carry
//      their true cadence (set from the invoice billing interval at sync
//      time) AND a stable subscription id (recurring_key). So we neither
//      infer a cadence nor require a >= 3-month history — Stripe already
//      told us it's a subscription and how often it bills.
//
//   2. Amount is NOT a safe grouping key. Many customers pay the same plan
//      price, so grouping by amount would collapse distinct subscriptions
//      and UNDER-count. We group strictly by recurring_key.
//
// The only job here is to stop the SAME subscription projecting forward once
// per charge: for each recurring_key keep the cadence on the latest-month
// charge (the anchor) and demote every earlier charge to one_off (real past
// revenue, already realized — not re-projected). Rows without a
// recurring_key (one-off sales, manual entries) are ignored entirely.

export type IncomeRowForRecurrence = {
  id: string;
  month: number; // 1-12
  recurring_key: string | null;
  recurrence: string | null;
};

/** Latest-month row of a group, ties broken by id for stability. */
function latestOf<T extends { month: number; id: string }>(group: T[]): T {
  return group.reduce((a, b) =>
    b.month > a.month || (b.month === a.month && b.id > a.id) ? b : a,
  );
}

/**
 * The cadence to carry forward for a subscription stream: the most recent
 * non-one_off recurrence seen on it (Stripe can change a plan's interval, so
 * trust the latest charge). Returns null if the whole stream is one_off —
 * nothing to anchor.
 */
function streamCadence(group: IncomeRowForRecurrence[]): RecurrenceValue | null {
  let best: { month: number; id: string; rec: RecurrenceValue } | null = null;
  for (const r of group) {
    const rec = (r.recurrence ?? "one_off") as RecurrenceValue;
    if (rec === "one_off") continue;
    if (
      !best ||
      r.month > best.month ||
      (r.month === best.month && r.id > best.id)
    ) {
      best = { month: r.month, id: r.id, rec };
    }
  }
  return best?.rec ?? null;
}

/**
 * Pure core: given a company's income rows, return only the recurrence
 * CHANGES needed so each subscription (recurring_key) projects forward from
 * exactly one anchor. Rows without a recurring_key are never touched.
 */
export function computeIncomeRecurrenceUpdates(
  rows: IncomeRowForRecurrence[],
): RecurrenceUpdate[] {
  const groups = new Map<string, IncomeRowForRecurrence[]>();
  for (const r of rows) {
    if (!r.recurring_key) continue; // not a subscription stream
    const arr = groups.get(r.recurring_key);
    if (arr) arr.push(r);
    else groups.set(r.recurring_key, [r]);
  }

  const updates: RecurrenceUpdate[] = [];
  for (const group of groups.values()) {
    const cadence = streamCadence(group);
    if (!cadence) continue; // stream is all one_off — leave it be
    const anchor = latestOf(group);
    for (const r of group) {
      const target: RecurrenceValue = r.id === anchor.id ? cadence : "one_off";
      const current = (r.recurrence ?? "one_off") as RecurrenceValue;
      if (target !== current) updates.push({ id: r.id, recurrence: target });
    }
  }
  return updates;
}

/**
 * Run the subscription-anchor pass against a company's income for a tax
 * year and persist the changes. Returns the number of rows updated.
 * Idempotent; safe to call after every sync.
 */
export async function applyRecurringIncomeDetection(
  admin: SupabaseClient,
  companyId: string,
  taxYear: number,
): Promise<number> {
  const { data: rows, error } = await admin
    .from("monthly_income")
    .select("id, month, recurring_key, recurrence")
    .eq("company_id", companyId)
    .eq("tax_year", taxYear)
    .not("recurring_key", "is", null);
  if (error) {
    console.error("[recurring-income] fetch failed", error.message);
    return 0;
  }
  if (!rows || rows.length === 0) return 0;

  const updates = computeIncomeRecurrenceUpdates(rows as IncomeRowForRecurrence[]);
  return persistRecurrenceUpdates(admin, "monthly_income", updates);
}
