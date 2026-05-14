import type { SupabaseClient } from "@supabase/supabase-js";

// Notification + inbox helpers.
//
// Two cheap reads + one write, all wrapped around the Phase 4
// migration's SECURITY DEFINER functions.

export async function getUnreadActivityCount(
  client: SupabaseClient,
  firmId: string,
): Promise<number> {
  try {
    const { data } = await client.rpc("unread_firm_activity_count", {
      p_firm_id: firmId,
    });
    return typeof data === "number" ? data : 0;
  } catch {
    return 0;
  }
}

export async function markActivityRead(
  client: SupabaseClient,
  firmId: string,
): Promise<void> {
  try {
    await client.rpc("mark_firm_activity_read", { p_firm_id: firmId });
  } catch {
    // Swallow — failing to bump the cursor is non-fatal; the user
    // will still see the items, they just stay "unread" on this
    // visit.
  }
}

// Event kinds to surface in the daily/weekly digest by default.
// Anything that's a system / housekeeping event (member_invited,
// member_joined) stays out — the digest is for "what did my
// clients + engagements DO since I last looked."
export const DIGEST_INTERESTING_KINDS: readonly string[] = [
  "client.company_created",
  "client.income_logged",
  "client.expense_logged",
  "client.bank_connected",
  "client.document_uploaded",
  "client.engagement_requested",
  "client.engagement_accepted",
  "client.message_sent",
  "firm.engagement_accepted",
  "firm.engagement_completed",
  "firm.document_signed",
  "firm.signature_requested",
  "firm.meeting_scheduled",
  "firm.invoice_sent",
  "firm.payment_received",
  "firm.tax_form_drafted",
  "firm.tax_form_filed",
];

export type DigestPreferences = {
  user_id: string;
  firm_id: string;
  digest_cadence: "off" | "daily" | "weekly";
  digest_hour_utc: number;
  excluded_kinds: string[];
};

export const DEFAULT_DIGEST_PREFS: Omit<DigestPreferences, "user_id" | "firm_id"> = {
  digest_cadence: "daily",
  digest_hour_utc: 13, // 9am ET, 6am PT — a defensible default
  excluded_kinds: [],
};
