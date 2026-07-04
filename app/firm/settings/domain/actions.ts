"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";
import {
  addDomainToProject,
  getDomainConfig,
  removeDomainFromProject,
} from "@/lib/firm/domains/vercel";
import { logFirmActivity } from "@/lib/firm/activity";

// Enterprise-tier-only: claim a custom domain (smithcpa-secure.com)
// pointing at Taxottic's wildcard hosting.
//
// Flow:
//   1. firm clicks Connect → server calls Vercel API to attach the
//      domain to our project + reads back the verification record
//      (TXT or CNAME the firm has to add to their DNS).
//   2. firm goes to their DNS provider, adds the record.
//   3. firm comes back, clicks "Check status" → we call Vercel
//      config endpoint; if `misconfigured=false` and `configuredBy`
//      is set, we flip status → 'active'.

export async function addCustomDomain(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  if (ctx.firm.tier !== "enterprise") {
    throw new Error("Custom domains are available on the Enterprise tier.");
  }
  const raw = String(formData.get("hostname") ?? "")
    .trim()
    .toLowerCase();
  // Permissive validation; Vercel rejects invalid hostnames itself.
  if (
    !raw ||
    raw.length > 253 ||
    !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(raw) ||
    raw.endsWith(".taxottic.com") ||
    raw === "taxottic.com"
  ) {
    throw new Error("Provide a valid domain (e.g., smithcpa-secure.com).");
  }

  // Insert pending row first so the UI shows progress.
  const { data: row, error: insertErr } = await admin
    .from("firm_custom_domains")
    .insert({
      firm_id: ctx.firm.id,
      hostname: raw,
      status: "pending_dns",
      added_by: user.id,
    })
    .select("id")
    .single();
  if (insertErr || !row) throw new Error(insertErr?.message ?? "Insert failed.");

  // Call Vercel, if env isn't configured we still keep the row so
  // the operator can add the domain manually + record verification
  // details by hand.
  const vercel = await addDomainToProject(raw);
  if (vercel.ok) {
    await admin
      .from("firm_custom_domains")
      .update({
        vercel_domain_id: vercel.vercel_domain_id,
        verification_record: vercel.verification,
      })
      .eq("id", row.id);
  } else {
    await admin
      .from("firm_custom_domains")
      .update({
        notes: `Vercel API: ${vercel.reason}`,
      })
      .eq("id", row.id);
  }

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    kind: "firm.note_added",
    summary: `Requested custom domain ${raw}.`,
    payload: { hostname: raw, vercel_ok: vercel.ok },
  });

  revalidatePath("/firm/settings/domain");
}

export async function refreshDomainStatus(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing domain id.");

  const { data: row } = await admin
    .from("firm_custom_domains")
    .select("hostname, status")
    .eq("id", id)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!row) throw new Error("Domain not found.");

  const config = await getDomainConfig(row.hostname);
  if (!config) {
    revalidatePath("/firm/settings/domain");
    return;
  }
  // If Vercel says configured + not misconfigured, flip to active.
  if (!config.misconfigured && config.configuredBy) {
    await admin
      .from("firm_custom_domains")
      .update({
        status: "active",
        verified_at: new Date().toISOString(),
      })
      .eq("id", id);
    await logFirmActivity({
      client: admin,
      firmId: ctx.firm.id,
      kind: "firm.note_added",
      summary: `Custom domain ${row.hostname} is live.`,
      payload: { hostname: row.hostname, configured_by: config.configuredBy },
    });
  } else if (config.configuredBy && config.misconfigured) {
    // DNS pointed at us but something's off, pin status as
    // pending_ssl so the UI surfaces the misconfiguration.
    await admin
      .from("firm_custom_domains")
      .update({ status: "pending_ssl" })
      .eq("id", id);
  }
  revalidatePath("/firm/settings/domain");
}

export async function removeCustomDomain(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing domain id.");

  const { data: row } = await admin
    .from("firm_custom_domains")
    .select("hostname")
    .eq("id", id)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!row) throw new Error("Domain not found.");

  // Best-effort Vercel detach; the DB row is the source of truth.
  await removeDomainFromProject(row.hostname);

  await admin
    .from("firm_custom_domains")
    .update({ status: "removed", removed_at: new Date().toISOString() })
    .eq("id", id);
  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    kind: "firm.note_added",
    summary: `Removed custom domain ${row.hostname}.`,
    payload: { hostname: row.hostname },
  });
  revalidatePath("/firm/settings/domain");
}
