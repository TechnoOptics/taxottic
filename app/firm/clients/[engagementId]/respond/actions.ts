"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";
import { logFirmActivity } from "@/lib/firm/activity";

/**
 * Accept or decline a client-requested engagement. Fills the gap the
 * engagement detail page's Accept/Decline buttons pointed at (they linked to a
 * /respond route that never existed, so a client-initiated engagement could
 * never be actioned). Owner/manager only; scoped to the caller's own firm; only
 * acts on a still-pending engagement.
 */
export async function respondToEngagement(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();

  const engagementId = String(formData.get("engagement_id") ?? "");
  const action = String(formData.get("action") ?? "");
  if (!engagementId) throw new Error("Missing engagement.");
  if (action !== "accept" && action !== "decline") {
    throw new Error("Invalid action.");
  }

  // Load + verify ownership. notFound-style guard: the engagement must belong
  // to THIS firm, and must still be awaiting the firm's response.
  const { data: eng } = await admin
    .from("firm_engagements")
    .select("id, firm_id, company_id, status")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng || eng.firm_id !== ctx.firm.id) {
    redirect("/firm/clients");
  }
  if (eng.status !== "pending_firm") {
    // Already actioned (or not the firm's turn), so bounce back with a note
    // rather than double-flipping.
    redirect(`/firm/clients/${engagementId}?already=1`);
  }

  const newStatus = action === "accept" ? "active" : "declined";
  const { error } = await admin
    .from("firm_engagements")
    .update({
      status: newStatus,
      responded_at: new Date().toISOString(),
      responded_by: user.id,
    })
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .eq("status", "pending_firm"); // guard against a race
  if (error) throw new Error(error.message);

  // Activity log has a "firm.engagement_accepted" kind but no declined kind;
  // the status change itself is the durable record of a decline.
  if (action === "accept") {
    await logFirmActivity({
      client: admin,
      firmId: ctx.firm.id,
      companyId: eng.company_id,
      engagementId,
      kind: "firm.engagement_accepted",
      summary: "Accepted the client engagement.",
    });
  }

  revalidatePath(`/firm/clients/${engagementId}`);
  revalidatePath("/firm/clients");
  revalidatePath("/firm");
  redirect(`/firm/clients/${engagementId}?responded=${action}`);
}
