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

  const marketing: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/?audience=personal`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/?audience=enterprise`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/book`,
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
  // their own sitemap entries.
  const legal: MetadataRoute.Sitemap = [
    "/legal",
    "/legal/privacy",
    "/legal/terms",
    "/legal/security",
    "/legal/subprocessors",
    "/legal/cookies",
    "/legal/acceptable-use",
    "/legal/dpa",
  ].map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...marketing, ...legal];
}
