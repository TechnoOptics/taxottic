/**
 * Article JSON-LD for the editorial guides.
 *
 * Every guide under app/guides/<slug>/ was building this literal by hand,
 * eleven near-identical copies, and all eleven were missing the three
 * fields Google actually asks for:
 *
 *   image           REQUIRED for Article rich results. Without it the
 *                   item is ineligible, not merely degraded.
 *   datePublished   recommended, and the input to freshness ranking
 *   dateModified    recommended, and what makes a re-edited guide look
 *                   re-edited rather than abandoned
 *
 * Centralising it is the point. The failure mode with eleven copies is
 * not that they were wrong, it is that guide twelve gets pasted from
 * guide eleven and inherits whatever was missing. A builder with
 * required arguments cannot be copied into that state: omit a date and
 * it does not compile.
 *
 * `image` is deliberately derived rather than passed. Each guide already
 * computes exactly this URL for `metadata.openGraph.images`, so deriving
 * it here keeps the social card and the structured data pointing at one
 * picture. Two hand-maintained copies of the same URL is how they drift.
 */

const SITE = "https://taxottic.com";

export type GuideArticleInput = {
  /** URL segment under /guides, e.g. "business-mileage-deduction". */
  slug: string;
  title: string;
  description: string;
  /**
   * ISO date (YYYY-MM-DD) the guide first shipped, and the date of its
   * last substantive edit.
   *
   * These MUST be the real dates. A backdated `datePublished` or a
   * `dateModified` bumped to today on a page nobody touched is exactly
   * the freshness-faking Google's guidelines name, and it is a manual
   * action risk for a YMYL tax site rather than a clever trick. Read
   * them from git:
   *
   *   git log --follow --format=%ad --date=short -- app/guides/<slug>/page.tsx
   *
   * with `tail -1` for published and `head -1` for modified.
   */
  published: string;
  modified: string;
};

export function guideArticleLd({
  slug,
  title,
  description,
  published,
  modified,
}: GuideArticleInput) {
  const url = `${SITE}/guides/${slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    mainEntityOfPage: url,
    url,
    // Same generator the page's own OG card uses, so the two never
    // disagree about what this guide looks like when it is shared.
    image: [`${SITE}/api/og/guide?title=${encodeURIComponent(title)}`],
    datePublished: published,
    dateModified: modified,
    author: { "@type": "Organization", name: "Taxottic", url: SITE },
    publisher: { "@id": `${SITE}/#organization` },
    inLanguage: "en-US",
  };
}
