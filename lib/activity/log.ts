import type { SupabaseClient } from "@supabase/supabase-js";

// Consumer-side activity logging. Mirrors lib/firm/activity but for a
// company's own books. Called from server actions with the service-role
// `admin` client (RLS denies direct writes to everyone else; reads are
// gated to company members).
//
// Best-effort: a logging failure must NEVER block the user's action, so we
// swallow errors, a missing audit row is a reporting bug, not a user-facing
// one.

export type CompanyActivityKind =
  | "company.created"
  | "income.created"
  | "income.updated"
  | "income.deleted"
  | "expense.created"
  | "expense.updated"
  | "expense.deleted"
  | "expense.reclassified"
  // A booked line moved across the income/expense divide. Two kinds, not
  // one, because the direction is the fact a CPA is looking for: these
  // rows are the permanent record that a filed number was restated, and
  // by whom. Written by moveBookedTransaction.
  | "expense.moved_to_income"
  | "income.moved_to_expense"
  | "expense.recurrence_stopped"
  | "expense.recurrence_resumed"
  | "profile.updated"
  | "bank.connected"
  | "bank.disconnected"
  | "import.applied"
  | "import.completed"
  | "mileage.added"
  | "mileage.classified"
  | "mileage.deleted"
  | "mileage.moved";

export async function logCompanyActivity(
  admin: SupabaseClient,
  args: {
    companyId: string;
    actorUserId: string | null;
    kind: CompanyActivityKind;
    summary: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("company_activity").insert({
      company_id: args.companyId,
      actor_user_id: args.actorUserId,
      kind: args.kind,
      summary: args.summary,
      payload: args.payload ?? {},
    });
  } catch {
    // best-effort; see module comment
  }
}
