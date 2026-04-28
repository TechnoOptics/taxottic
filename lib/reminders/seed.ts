import type { SupabaseClient } from "@supabase/supabase-js";
import { quarterlyDueDates } from "./quarterly";

/**
 * Idempotent seed: inserts any missing quarterly + filing reminders for a user
 * and tax year. Skips ones already present (by user_id + kind + due_at year).
 */
export async function ensureQuarterlyReminders(
  supabase: SupabaseClient,
  userId: string,
  taxYear: number,
) {
  const reminders = quarterlyDueDates(taxYear);

  const { data: existing } = await supabase
    .from("reminders")
    .select("kind, due_at")
    .eq("user_id", userId)
    .gte("due_at", `${taxYear}-01-01T00:00:00Z`)
    .lte("due_at", `${taxYear + 1}-12-31T23:59:59Z`);

  const have = new Set(
    (existing ?? []).map(
      (r) => `${r.kind}:${new Date(r.due_at).toISOString().slice(0, 10)}`,
    ),
  );

  const toInsert = reminders
    .filter(
      (r) => !have.has(`${r.kind}:${r.due.toISOString().slice(0, 10)}`),
    )
    .map((r) => ({
      user_id: userId,
      kind: r.kind,
      title: r.label,
      body: bodyFor(r.kind),
      due_at: r.due.toISOString(),
    }));

  if (toInsert.length === 0) return;

  // Best-effort: failure here shouldn't prevent dashboard from rendering.
  try {
    await supabase.from("reminders").insert(toInsert);
  } catch {
    // ignore
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
