"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";

const VALID_KINDS = new Set([
  "tax_prep",
  "audit_support",
  "bookkeeping",
  "advisory",
]);

async function assertManagerOf(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  userId: string,
  companyId: string,
) {
  const { data } = await admin
    .from("company_members")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Not a member of this company.");
  if (data.role !== "manager") {
    throw new Error("Only the company manager can manage preparers.");
  }
}

/**
 * The client-side initiates an engagement: "I want firm X to prepare
 * my Y return for tax year Z." Status starts as pending_firm; the
 * firm sees it on their side and accepts (which RLS-unlocks read
 * access to the company's books).
 */
export async function requestEngagement(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const firmId = String(formData.get("firm_id") ?? "");
  const taxYear = Number(formData.get("tax_year"));
  const kindRaw = String(formData.get("kind") ?? "tax_prep");
  const kind = VALID_KINDS.has(kindRaw) ? kindRaw : "tax_prep";
  const clientNote =
    String(formData.get("client_note") ?? "").trim() || null;

  if (!companyId || !firmId) throw new Error("Missing input");
  if (!Number.isFinite(taxYear)) throw new Error("Invalid tax year.");
  // Plausible window: this year, last year, next year.
  const now = new Date().getUTCFullYear();
  if (taxYear < now - 3 || taxYear > now + 1) {
    throw new Error("Pick a tax year between last 3 years and next year.");
  }

  await assertManagerOf(admin, user.id, companyId);

  // Firm must be active. RLS would surface it via "firms: public read
  // active", but we check explicitly so we can return a clean error.
  const { data: firm } = await admin
    .from("firms")
    .select("id, status")
    .eq("id", firmId)
    .maybeSingle();
  if (!firm) throw new Error("Firm not found.");
  if (firm.status !== "active") {
    throw new Error("That firm is not currently accepting clients.");
  }

  // Insert. The unique (firm_id, company_id, tax_year, kind) constraint
  // prevents duplicate active requests; a Postgres unique violation
  // surfaces as "duplicate key value violates unique constraint" - we
  // translate to plain English.
  const { error } = await admin.from("firm_engagements").insert({
    firm_id: firmId,
    company_id: companyId,
    tax_year: taxYear,
    kind,
    status: "pending_firm",
    requested_by: user.id,
    requested_by_side: "client",
    client_note: clientNote,
  });
  if (error) {
    if (
      error.message.toLowerCase().includes("duplicate") ||
      error.code === "23505"
    ) {
      throw new Error(
        "You already have a request for this firm + tax year + service. Cancel that one first to send a new request.",
      );
    }
    throw new Error(error.message);
  }

  // Find the company's public_id for revalidation.
  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) revalidatePath(`/c/${company.public_id}/preparer`);
}

/**
 * Cancel a pending request you initiated. Only meaningful for
 * status='pending_firm' (you sent it; the firm hasn't responded yet).
 * For accepted engagements use endEngagement instead.
 */
export async function cancelEngagement(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const engagementId = String(formData.get("engagement_id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  if (!engagementId || !companyId) throw new Error("Missing input");

  await assertManagerOf(admin, user.id, companyId);

  const { data: eng } = await admin
    .from("firm_engagements")
    .select("id, company_id, status")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng || eng.company_id !== companyId) {
    throw new Error("Engagement not found.");
  }
  if (eng.status !== "pending_firm") {
    throw new Error(
      "Only requests still awaiting the firm's acceptance can be cancelled.",
    );
  }

  const { error } = await admin
    .from("firm_engagements")
    .update({
      status: "declined",
      responded_at: new Date().toISOString(),
      responded_by: user.id,
    })
    .eq("id", engagementId);
  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) revalidatePath(`/c/${company.public_id}/preparer`);
}

/**
 * Accept a firm-initiated request. The firm contacted you ("we'd like
 * to prepare your return") and you're saying yes - this flips the
 * engagement to active and unlocks RLS on your books for that firm.
 */
export async function acceptFirmInitiatedEngagement(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const engagementId = String(formData.get("engagement_id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  if (!engagementId || !companyId) throw new Error("Missing input");

  await assertManagerOf(admin, user.id, companyId);

  const { data: eng } = await admin
    .from("firm_engagements")
    .select("id, company_id, status")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng || eng.company_id !== companyId) {
    throw new Error("Engagement not found.");
  }
  if (eng.status !== "pending_client") {
    throw new Error("This request isn't waiting on you.");
  }

  const { error } = await admin
    .from("firm_engagements")
    .update({
      status: "active",
      responded_at: new Date().toISOString(),
      responded_by: user.id,
    })
    .eq("id", engagementId);
  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) revalidatePath(`/c/${company.public_id}/preparer`);
}

export async function declineFirmInitiatedEngagement(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const engagementId = String(formData.get("engagement_id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  if (!engagementId || !companyId) throw new Error("Missing input");

  await assertManagerOf(admin, user.id, companyId);

  const { error } = await admin
    .from("firm_engagements")
    .update({
      status: "declined",
      responded_at: new Date().toISOString(),
      responded_by: user.id,
    })
    .eq("id", engagementId)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) revalidatePath(`/c/${company.public_id}/preparer`);
}

/**
 * End an active engagement. The firm immediately loses RLS access to
 * the books. Used when the client switches preparers, the year is
 * complete, or the relationship sours.
 */
export async function endEngagement(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const engagementId = String(formData.get("engagement_id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  if (!engagementId || !companyId) throw new Error("Missing input");

  await assertManagerOf(admin, user.id, companyId);

  const { data: eng } = await admin
    .from("firm_engagements")
    .select("id, company_id, status")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng || eng.company_id !== companyId) {
    throw new Error("Engagement not found.");
  }
  if (eng.status !== "active") {
    throw new Error("Only active engagements can be ended.");
  }

  const { error } = await admin
    .from("firm_engagements")
    .update({
      status: "terminated",
      ended_at: new Date().toISOString(),
      responded_by: user.id,
    })
    .eq("id", engagementId);
  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) revalidatePath(`/c/${company.public_id}/preparer`);
}

/**
 * Search for active firms by name or public_id. Used by the
 * find-a-preparer dialog. Returns at most 25 results.
 */
export async function searchFirms(query: string) {
  const { admin } = await requireUserWithAdmin();
  const q = query.trim();
  let builder = admin
    .from("firms")
    .select(
      "id, public_id, name, logo_url, accent_color, city, state_code, website",
    )
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(25);

  if (q.length > 0) {
    // Match on name (case-insensitive) OR public_id prefix.
    builder = builder.or(
      `name.ilike.%${q.replace(/[%_]/g, "")}%,public_id.ilike.%${q.replace(/[%_]/g, "")}%`,
    );
  }

  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return data ?? [];
}
