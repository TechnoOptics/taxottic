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
  recurrence_end_month?: number | null;
};

export type RecurrenceValue =
  | "one_off"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual";
export type RecurrenceUpdate = {
  id: string;
  recurrence: RecurrenceValue;
  // Set when the stream is detected as STOPPED (see "stopped stream"
  // detection below) — caps the forecast projection right after the
  // last real occurrence instead of projecting through December.
  // Present with value `null` means "clear any previous end month"
  // (the stream resumed), so it must be written even when null.
  recurrence_end_month?: number | null;
};

/** Minimum distinct months a stream must span to count as recurring. */
export const MIN_RECURRING_MONTHS = 3;

/**
 * How many cycles of silence before we call a stream stopped rather than
 * "sync just hasn't caught up yet". Monthly gets 2 full cycles (2 months)
 * since a bank pull landing a few days late is common. Quarterly gets 1
 * full cycle (3 months): with MIN_RECURRING_MONTHS = 3, the earliest a
 * quarterly stream can even qualify as recurring is 3 occurrences spread
 * across 6 months (e.g. months 1, 4, 7 — anchor month 7) — at 2 cycles
 * (6 more months) the stopped-check would need asOfMonth >= 13, which is
 * impossible within a single tax year, so quarterly would never fire.
 * 1 cycle (3 months) keeps it reachable while still requiring a full
 * missed billing period, not just a slightly-late sync.
 */
const STOPPED_AFTER_CYCLES: Record<"monthly" | "quarterly", number> = {
  monthly: 2,
  quarterly: 1,
};

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
 *
 * `asOfMonth` is the latest month we actually have synced/entered data
 * for (1-12) — used to detect a stream that's gone quiet: if the
 * anchor's cadence says another occurrence should have shown up by now
 * and it's been silent for STOPPED_AFTER_CYCLES full cycles, we cap the
 * anchor's recurrence_end_month at its own month instead of letting the
 * forecast keep projecting a cancelled subscription through December.
 * Omit `asOfMonth` to skip stopped-stream detection entirely (existing
 * behaviour) — every current caller passes it.
 */
export function computeRecurrenceUpdates(
  rows: ExpenseRowForRecurrence[],
  asOfMonth?: number,
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
    // recurrence_end_month to write per row id — undefined = "don't touch
    // it" (avoids clobbering a manual "user says so" stop set elsewhere),
    // null = "clear it" (stream resumed), a number = "cap it here".
    const wantEndMonth = new Map<string, number | null>();
    if (distinctMonths.length >= MIN_RECURRING_MONTHS) {
      const cadence = inferCadence(distinctMonths);
      // Anchor = single latest-month row (ties broken by id for stability).
      const anchor = group.reduce((a, b) =>
        b.month > a.month || (b.month === a.month && b.id > a.id) ? b : a,
      );
      for (const r of group) {
        want.set(r.id, r.id === anchor.id ? cadence : "one_off");
      }
      if (asOfMonth != null) {
        const cadenceStep = cadence === "quarterly" ? 3 : 1;
        const silentSince = asOfMonth - anchor.month;
        const stopped = silentSince >= cadenceStep * STOPPED_AFTER_CYCLES[cadence];
        // Cap right at the anchor's own month when stopped (its real
        // occurrence still counts; nothing projects past it). Clear
        // (null) when the anchor is current again — the stream resumed.
        // Only touch it if that's an actual change from what's stored,
        // so a re-run doesn't keep rewriting the same value.
        const nextEndMonth = stopped ? anchor.month : null;
        if ((anchor.recurrence_end_month ?? null) !== nextEndMonth) {
          wantEndMonth.set(anchor.id, nextEndMonth);
        }
      }
    } else {
      // Too few to be recurring — ensure none are left marked recurring.
      for (const r of group) want.set(r.id, "one_off");
    }
    for (const r of group) {
      const target = want.get(r.id)!;
      const current = (r.recurrence ?? "one_off") as RecurrenceValue;
      const targetEndMonth = wantEndMonth.get(r.id);
      const recurrenceChanged = target !== current;
      if (recurrenceChanged || targetEndMonth !== undefined) {
        updates.push({
          id: r.id,
          recurrence: target,
          ...(targetEndMonth !== undefined
            ? { recurrence_end_month: targetEndMonth }
            : {}),
        });
      }
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
 * Persist a set of recurrence changes to `table`, batching by the exact
 * set of fields being written (recurrence, and recurrence_end_month when
 * present) so same-shaped updates share one statement, and id-chunk so we
 * issue a few bounded statements per shape.
 */
async function persistRecurrenceUpdates(
  admin: SupabaseClient,
  table: "monthly_income" | "monthly_expenses",
  updates: RecurrenceUpdate[],
): Promise<number> {
  if (updates.length === 0) return 0;
  const byShape = new Map<
    string,
    { patch: Record<string, unknown>; ids: string[] }
  >();
  for (const u of updates) {
    const patch: Record<string, unknown> = { recurrence: u.recurrence };
    if (u.recurrence_end_month !== undefined) {
      patch.recurrence_end_month = u.recurrence_end_month;
    }
    const key = JSON.stringify(patch);
    const entry = byShape.get(key) ?? { patch, ids: [] };
    entry.ids.push(u.id);
    byShape.set(key, entry);
  }
  for (const { patch, ids } of byShape.values()) {
    for (const ids100 of chunk(ids, 100)) {
      const { error } = await admin
        .from(table)
        .update(patch)
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
    .select(
      "id, month, amount_cents, category_code, recurrence, recurrence_end_month",
    )
    .eq("company_id", companyId)
    .eq("tax_year", taxYear)
    // A manager who already marked an expense "personal" made an explicit
    // call the detector shouldn't second-guess — leave it out of both the
    // recurrence inference and the stopped-stream check entirely.
    .eq("classification", "business");
  if (error) {
    console.error("[recurring] fetch failed", error.message);
    return 0;
  }
  if (!rows || rows.length === 0) return 0;

  // "As of" the freshest month actually present in this sheet/bank pull
  // — i.e. relative to the data we really have, not wall-clock "today",
  // so a sync that hasn't caught up yet never falsely reads as silence.
  const asOfMonth = rows.reduce((max, r) => Math.max(max, r.month), 0);
  const updates = computeRecurrenceUpdates(
    rows as ExpenseRowForRecurrence[],
    asOfMonth,
  );
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
