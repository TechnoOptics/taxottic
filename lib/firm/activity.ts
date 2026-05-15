import type { SupabaseClient } from "@supabase/supabase-js";

// Activity logger used by every firm-facing server action.
//
// All writes funnel through the SECURITY DEFINER fn
// `log_firm_activity(...)`. That function re-checks permissions, so
// even a buggy caller can't insert a row pretending to be a
// different firm. The application layer just has to choose the
// right `kind` enum + payload shape + a one-line human-readable
// summary.
//
// We deliberately swallow logging failures: an activity-log write
// failing should never block a user action. A missing log row is a
// reporting bug, not a user-facing one.

export type ActivityKind =
  | "client.company_created"
  | "client.income_logged"
  | "client.expense_logged"
  | "client.bank_connected"
  | "client.document_uploaded"
  | "client.engagement_requested"
  | "client.engagement_accepted"
  | "client.message_sent"
  | "firm.engagement_created"
  | "firm.engagement_accepted"
  | "firm.engagement_completed"
  | "firm.preparer_assigned"
  | "firm.document_uploaded"
  | "firm.document_signed"
  | "firm.signature_requested"
  | "firm.meeting_scheduled"
  | "firm.invoice_sent"
  | "firm.payment_received"
  | "firm.tax_form_drafted"
  | "firm.tax_form_filed"
  | "firm.note_added"
  | "firm.member_invited"
  | "firm.member_joined"
  | "firm.member_removed";

export type ActorSide = "firm" | "client" | "system";

export type LogActivityArgs = {
  client: SupabaseClient;
  firmId: string;
  companyId?: string | null;
  engagementId?: string | null;
  kind: ActivityKind;
  payload?: Record<string, unknown>;
  summary: string;
  actorSide?: ActorSide;
};

export async function logFirmActivity({
  client,
  firmId,
  companyId,
  engagementId,
  kind,
  payload,
  summary,
  actorSide = "firm",
}: LogActivityArgs): Promise<void> {
  try {
    await client.rpc("log_firm_activity", {
      p_firm_id: firmId,
      p_company_id: companyId ?? null,
      p_engagement_id: engagementId ?? null,
      p_kind: kind,
      p_payload: payload ?? {},
      p_summary: summary,
      p_actor_side: actorSide,
    });
  } catch {
    // Swallow. See module comment.
  }
}
