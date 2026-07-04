import type { CrossTenantMeta } from "@/lib/tax/company-context";

// Persistent banner rendered above every /c/[publicId]/* page when the
// current user is a super-admin reading a tenant they do NOT own.
//
// Round-2 governance audit recommendation: make cross-tenant access
// visible. Without this banner, support agents and engineers could
// be looking at a customer's data without realizing they're not on
// their own dashboard, and the tenant has no signal that it
// happened.
//
// The matching audit-log row is written from
// loadCompanyByPublicId() at the same time the banner is rendered,
// so what the user sees and what the tenant can audit are produced
// from the same code path.

export type Props = {
  meta: CrossTenantMeta;
  tenantName: string;
};

export function SuperAdminCrossTenantBanner({ meta, tenantName }: Props) {
  if (!meta.isCrossTenant) return null;
  // Owner identity: prefer "Full Name <email>" but degrade gracefully
  // if either side is missing. Profile rows might lack a full_name
  // (OAuth-only signup with no first/last yet) or, very rarely, an
  // email (manual data fix-up). The audit-log row still has the
  // user_id either way.
  const ownerLine =
    meta.tenantOwnerName && meta.tenantOwnerEmail
      ? `${meta.tenantOwnerName} <${meta.tenantOwnerEmail}>`
      : (meta.tenantOwnerName ?? meta.tenantOwnerEmail ?? "owner unknown");

  return (
    <div
      role="region"
      aria-label="Cross-tenant super-admin access notice"
      className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/30 dark:text-amber-100"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
        <span aria-hidden="true">●</span>
        <span className="font-semibold">Viewing as super-admin</span>
        <span aria-hidden="true" className="opacity-50">·</span>
        <span className="normal-case tracking-normal">
          Tenant: <span className="font-medium">{tenantName}</span>
        </span>
        <span aria-hidden="true" className="opacity-50">·</span>
        <span className="normal-case tracking-normal">
          Owner: <span className="font-medium">{ownerLine}</span>
        </span>
        <span
          aria-hidden="true"
          className="ml-auto opacity-60 normal-case tracking-normal"
        >
          This visit was logged for the tenant&apos;s audit history.
        </span>
      </div>
    </div>
  );
}
