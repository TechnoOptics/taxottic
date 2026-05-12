import type { SupabaseClient } from "@supabase/supabase-js";
import { quarterlyDueDates } from "./quarterly";

/**
 * Idempotent seed: inserts any missing quarterly + filing reminders for a user
 * and tax year.
 *
 * Earlier this function did a SELECT-then-INSERT, which is racy under
 * the dashboard's Promise.all hot path: two concurrent renders could
 * both observe "no rows" and both insert, producing duplicate
 * reminders. The fix is a single UPSERT with onConflict on the
 * (user_id, kind, due-date) unique index added in migration
 * 20260511000002. PostgREST's `ignoreDuplicates: true` translates to
 * ON CONFLICT DO NOTHING, so concurrent inserts collide cleanly and
 * idempotency is now enforced at the DB level rather than via a
 * read-then-write window.
 */
export async function ensureQuarterlyReminders(
  supabase: SupabaseClient,
  userId: string,
  taxYear: number,
) {
  const reminders = quarterlyDueDates(taxYear);
  if (reminders.length === 0) return;

  const rows = reminders.map((r) => ({
    user_id: userId,
    kind: r.kind,
    title: r.label,
    body: bodyFor(r.kind),
    due_at: r.due.toISOString(),
  }));

  // UPSERT with ignoreDuplicates -> ON CONFLICT DO NOTHING. The
  // matching unique index is reminders_user_kind_dueday_uq, defined
  // on (user_id, kind, (due_at at time zone 'UTC')::date). We pass
  // the column list onConflict accepts even though it actually
  // resolves the index by column-set match.
  try {
    await supabase
      .from("reminders")
      .upsert(rows, {
        onConflict: "user_id,kind,due_at",
        ignoreDuplicates: true,
      });
  } catch {
    // Non-fatal: dashboard still renders; cron retries.
  }
}

function bodyFor(kind: string): string {
  const map: Record<string, string> = {
    q1_payment:
      "First quarter estimated tax payment is due. Form 1040-ES covers Jan-Mar income.",
    q2_payment:
      "Second quarter estimated tax payment is due. Covers Apr-May income.",
    q3_payment:
      "Third quarter estimated tax payment is due. Covers Jun-Aug income.",
    q4_payment:
      "Fourth quarter estimated tax payment is due. Covers Sep-Dec income.",
    filing_deadline:
      "Federal tax return filing deadline. File or request an extension.",
    extension_deadline:
      "Extended return filing deadline if you filed Form 4868.",
  };
  return map[kind] ?? "";
}
