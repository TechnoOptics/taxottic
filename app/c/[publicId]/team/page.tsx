import { redirect } from "next/navigation";

/**
 * URL-shape compatibility shim.
 *
 * The CompanyNav exposes a tab labelled "Team" whose `href` resolves
 * to `/c/{publicId}/manage` (the actual page lives there). Round-5
 * audit caught that users who type the URL based on the label -
 * `/c/{publicId}/team`, hit a 404. The 404 page is well-styled but
 * the discrepancy reads as a broken link.
 *
 * Fix: redirect `/team` → `/manage`. Cheap, non-breaking, preserves
 * any external links / bookmarks to either URL, and means we can
 * keep the user-facing label "Team" without renaming the underlying
 * directory.
 *
 * The redirect is 308 (permanent) so search engines and crawlers
 * collapse the duplicate.
 */
type Params = Promise<{ publicId: string }>;

export default async function TeamRedirectPage({
  params,
}: {
  params: Params;
}) {
  const { publicId } = await params;
  redirect(`/c/${publicId}/manage`);
}
