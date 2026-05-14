import { redirect } from "next/navigation";

/**
 * URL-shape compatibility shim — same rationale as ./team/page.tsx.
 *
 * The CompanyNav exposes a tab labelled "Tax preparer" whose `href`
 * resolves to `/c/{publicId}/preparer`. Round-5 audit caught that
 * users typing the URL based on the label (`/tax-preparer`) hit a
 * 404. This page redirects `/tax-preparer` → `/preparer` so both
 * URLs resolve to the canonical destination.
 */
type Params = Promise<{ publicId: string }>;

export default async function TaxPreparerRedirectPage({
  params,
}: {
  params: Params;
}) {
  const { publicId } = await params;
  redirect(`/c/${publicId}/preparer`);
}
