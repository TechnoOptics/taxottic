import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { SuperAdminCrossTenantBanner } from "@/components/SuperAdminCrossTenantBanner";

// Shared layout for every /c/[publicId]/* page. The only thing it
// renders today is the super-admin cross-tenant banner, which has
// to appear above the AppHeader on every company surface (forecast,
// income, expenses, banks, …) so an admin / engineer always sees
// "I'm not on my own data" regardless of how they navigated in.
//
// `loadCompanyByPublicId` redirect/notFound semantics are intentionally
// not caught: those are how Next.js routes a missing company to 404 or
// pushes an unauth'd user to /login. Letting them propagate from the
// layout is equivalent to letting them propagate from the leaf page,
// which is exactly what we want, the user lands on the standard
// 404/login screen either way.

type Params = Promise<{ publicId: string }>;

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Params;
}) {
  const { publicId } = await params;
  const { company, crossTenant } = await loadCompanyByPublicId(publicId);
  return (
    <>
      {crossTenant?.isCrossTenant ? (
        <SuperAdminCrossTenantBanner
          meta={crossTenant}
          tenantName={company.name}
        />
      ) : null}
      {children}
    </>
  );
}
