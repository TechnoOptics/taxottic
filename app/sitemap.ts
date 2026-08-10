import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { CALC_STATES } from "@/lib/calculators/states";
import { CALC_INCOMES } from "@/lib/calculators/incomes";

/**
 * /sitemap.xml, host-aware.
 *
 *   - taxottic.com: full marketing + legal sitemap.
 *   - hq.taxottic.com / enterprise.taxottic.com: empty sitemap.
 *     The admin subdomains are noindex'd at robots.txt + meta level,
 *     so we don't advertise a sitemap there either. Returning an
 *     empty list is the cleanest way to satisfy the route handler
 *     without leaking admin URLs.
 *
 * App routes behind auth (dashboard, settings, /c/[publicId]/*) are
 * intentionally omitted from the consumer sitemap, they redirect to
 * /login when unauthed and have no public-search value.
 *
 * lastModified uses build time as a conservative default; we don't
 * have per-page edit timestamps for the marketing content, and a
 * weekly-stable date is appropriate for these mostly-static pages.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host")?.toLowerCase() ?? "";
  const isAdminHost =
    host === "hq.taxottic.com" || host === "enterprise.taxottic.com";
  if (isAdminHost) {
    // Empty sitemap on admin hosts, no URLs to advertise.
    return [];
  }
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com";
  const now = new Date();

  // The two audience toggles aren't separate URLs as far as Google is
  // concerned, the home page canonical resolves them both back to
  // `/` (May 2026 audit P2). Keep `/` as the single sitemap entry for
  // the marketing root so we don't accidentally signal a separate
  // indexable URL per ?audience=value.
  const marketing: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/pricing`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/example`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/help`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/changelog`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/book`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/book?for=firm`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    // NB: /firms is intentionally NOT listed, next.config.ts 308-redirects
    // it to /book?for=firm (a vanity URL for firm proposals), and a sitemap
    // must advertise the final destination, not a redirect. The destination
    // is the entry above.
  ];

  // Editorial guides hub + articles. Real long-form content targeting
  // high-intent search queries; high priority because this is the
  // surface most likely to win organic traffic + AI citations.
  const guides: MetadataRoute.Sitemap = [
    "/guides",
    "/guides/self-employment-tax-how-much-to-set-aside",
    "/guides/schedule-c-deductions",
    "/guides/quarterly-estimated-taxes-explained",
    "/guides/home-office-deduction",
    "/guides/1099-vs-w2",
    "/guides/first-year-freelancer-tax-checklist",
    "/guides/sole-proprietor-vs-llc-vs-s-corp-taxes",
    "/guides/business-mileage-deduction",
    "/guides/qbi-deduction",
    "/guides/self-employed-health-insurance-deduction",
    "/guides/what-is-a-1099-k",
  ].map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: path === "/guides" ? 0.8 : 0.7,
  }));

  // Free interactive calculators. Tool-shaped pages targeting the
  // highest-volume, highest-intent tax queries ("self-employment tax
  // calculator", "1099 tax calculator"). High priority, interactive
  // tools rank well, earn backlinks, and demonstrate the product's
  // value instantly, so this is a top organic-acquisition surface.
  const calculators: MetadataRoute.Sitemap = [
    "/calculators",
    "/calculators/self-employment-tax",
    "/calculators/quarterly-estimated-tax",
    "/calculators/1099-tax",
    "/calculators/mileage-deduction",
    "/calculators/mileage-reimbursement",
    "/calculators/how-much-to-set-aside",
    "/calculators/effective-tax-rate",
  ].map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: path === "/calculators" ? 0.8 : 0.9,
  }));

  // Programmatic per-state self-employment-tax pages (50 + DC). Real
  // per-state numbers, so each is a substantive page targeting
  // "self-employment tax in {state}" / "1099 taxes {state}".
  const stateCalculators: MetadataRoute.Sitemap = CALC_STATES.map((s) => ({
    url: `${baseUrl}/calculators/self-employment-tax/${s.slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  // Programmatic "self-employment tax on $X" pages. Each targets a
  // specific high-volume query ("how much tax on 100k self employed")
  // with a real computed breakdown, so each is a substantive answer page.
  const incomeCalculators: MetadataRoute.Sitemap = CALC_INCOMES.map((n) => ({
    url: `${baseUrl}/calculators/self-employment-tax/on/${n}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  // Comparison / "alternative to" pages. High commercial-intent
  // ("[competitor] alternative" searches signal someone ready to
  // switch), so they rank + convert well.
  const compare: MetadataRoute.Sitemap = [
    "/compare",
    "/compare/quickbooks-self-employed-alternative",
    "/compare/keeper-alternative",
  ].map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  // Legal hub + sub-pages. These are linked from the footer and exist
  // as real documents (DPA, privacy, terms, etc.) so they deserve
  // their own sitemap entries. /legal/dmca and /legal/accessibility
  // were added in the May 2026 audit fix-up.
  const legal: MetadataRoute.Sitemap = [
    "/legal",
    "/legal/privacy",
    "/legal/terms",
    "/legal/location-monitoring",
    "/legal/security",
    "/legal/subprocessors",
    "/legal/cookies",
    "/legal/acceptable-use",
    "/legal/dpa",
    "/legal/dmca",
    "/legal/accessibility",
  ].map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [
    ...marketing,
    ...calculators,
    ...stateCalculators,
    ...incomeCalculators,
    ...compare,
    ...guides,
    ...legal,
  ];
}
