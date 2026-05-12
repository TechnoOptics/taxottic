import type { MetadataRoute } from "next";

/**
 * /sitemap.xml for taxottic.com.
 *
 * Lists only the public-facing marketing + legal pages. App routes
 * behind auth (dashboard, settings, /c/[publicId]/*) and admin routes
 * are intentionally omitted - they redirect to /login when unauthed
 * and have no public-search value.
 *
 * lastModified uses build time as a conservative default; we don't
 * have per-page edit timestamps for the marketing content, and a
 * weekly-stable date is appropriate for these mostly-static pages.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com";
  const now = new Date();

  // The two audience toggles aren't separate URLs as far as Google is
  // concerned — the home page canonical resolves them both back to
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
    {
      url: `${baseUrl}/firms`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
  ];

  // Legal hub + sub-pages. These are linked from the footer and exist
  // as real documents (DPA, privacy, terms, etc.) so they deserve
  // their own sitemap entries. /legal/dmca and /legal/accessibility
  // were added in the May 2026 audit fix-up.
  const legal: MetadataRoute.Sitemap = [
    "/legal",
    "/legal/privacy",
    "/legal/terms",
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

  return [...marketing, ...legal];
}
