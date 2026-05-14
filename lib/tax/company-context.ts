import { cache } from "react";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

export type CompanyRow = {
  id: string;
  public_id: string;
  name: string;
  entity_type: string | null;
  state_code: string | null;
  logo_url: string | null;
  // Surfaced so callers can suppress noise like "missed Q1 estimate"
  // for companies that didn't exist before the quarter's due date
  // (audit Medium #2).
  created_at: string;
};

// Metadata surfaced to /c/[publicId]/* pages when the current user is
// reading a tenant they don't own (super-admin RLS bypass). Used by
// SuperAdminCrossTenantBanner to render a visible "Viewing as
// super-admin · {tenant} · {owner}" notice. When the user IS a
// member of the company, every field is null and the banner doesn't
// render.
export type CrossTenantMeta = {
  isCrossTenant: boolean;
  tenantOwnerEmail: string | null;
  tenantOwnerName: string | null;
};

// React's cache() memoizes for the lifetime of a single request, so
// when both the /c/[publicId]/layout.tsx and the leaf page call
// loadCompanyByPublicId(slug), only one DB roundtrip — and only one
// audit-log row — actually happens. Without this, every cross-tenant
// page load would log the access twice (once from the layout, once
// from the page) and double the supabase round-trips on the hot
// path.
export const loadCompanyByPublicId = cache(_loadCompanyByPublicId);

async function _loadCompanyByPublicId(publicId: string) {
  const { supabase, user } = await requireUser();
  // .is("deleted_at", null) — companies in the recycle bin look like
  // a 404 to every /c/[publicId]/* page so users can't accidentally
  // edit data on a company they meant to delete. The recycle bin UI
  // is the only place they should see soft-deleted companies; from
  // there they can either Restore (which clears deleted_at) or
  // Permanently delete.
  const { data: company } = await supabase
    .from("companies")
    .select(
      "id, public_id, name, entity_type, state_code, logo_url, created_at",
    )
    .eq("public_id", publicId)
    .is("deleted_at", null)
    .single<CompanyRow>();
  if (!company) notFound();

  const { data: membership } = await supabase
    .from("company_members")
    .select("role")
    .eq("company_id", company.id)
    .eq("user_id", user.id)
    .maybeSingle();

  // Resolve cross-tenant metadata. The company row only loads for
  // non-members when RLS lets it through, which only happens for
  // super-admins. We treat (loaded successfully && !membership) as
  // the trigger for cross-tenant disclosure + audit logging.
  let crossTenant: CrossTenantMeta = {
    isCrossTenant: false,
    tenantOwnerEmail: null,
    tenantOwnerName: null,
  };
  if (!membership) {
    const admin = createServiceClient();
    // Pull the manager (preferred) — the first non-soft-deleted member
    // with role=manager. If none, fall back to the earliest member.
    const { data: managerRow } = await admin
      .from("company_members")
      .select("user_id, role, joined_at")
      .eq("company_id", company.id)
      .order("joined_at", { ascending: true });
    const owner =
      managerRow?.find((r) => r.role === "manager") ?? managerRow?.[0] ?? null;
    let ownerEmail: string | null = null;
    let ownerName: string | null = null;
    if (owner) {
      const { data: ownerProfile } = await admin
        .from("profiles")
        .select("email, full_name")
        .eq("id", owner.user_id)
        .maybeSingle();
      ownerEmail = ownerProfile?.email ?? null;
      ownerName = ownerProfile?.full_name ?? null;
    }
    crossTenant = {
      isCrossTenant: true,
      tenantOwnerEmail: ownerEmail,
      tenantOwnerName: ownerName,
    };
    // Best-effort audit log. SECURITY DEFINER fn re-checks
    // is_super_admin() so a stale `membership` check doesn't let a
    // regular user spam the log. Failures don't break the page.
    try {
      const h = await headers();
      const host = h.get("host") ?? null;
      const pathHeader =
        h.get("x-invoke-path") ?? h.get("next-url") ?? h.get("referer") ?? null;
      await supabase.rpc("log_cross_tenant_access", {
        p_company_id: company.id,
        p_path: pathHeader,
        p_host: host,
      });
    } catch {
      // Swallow — the banner is the user-visible signal; the log is
      // a forensic backup.
    }
  }

  return {
    supabase,
    user,
    company,
    isManager: membership?.role === "manager",
    crossTenant,
  };
}
