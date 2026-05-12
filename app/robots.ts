import type { MetadataRoute } from "next";

/**
 * /robots.txt for taxottic.com.
 *
 * The public marketing surface (`/`, `/legal/*`, `/book`) is intentionally
 * crawlable so we show up in tax-prep-software search results. Everything
 * else is either authentication, billing, or per-account application UI
 * and has no SEO value - we block crawlers from those paths explicitly so
 * Google doesn't waste crawl budget on login redirects or 401'd app pages.
 *
 * The hq.taxottic.com admin surface is rendered through middleware and
 * goes through the same /admin/* prefix internally, so disallowing
 * /admin keeps the ops console out of search results.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com";
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/legal/",
          "/book",
          "/firms",
        ],
        disallow: [
          "/api/",
          "/auth/",
          "/login",
          "/dashboard",
          "/settings",
          "/billing",
          "/onboarding/",
          "/c/",
          "/admin",
          "/admin/",
          "/personal/",
          "/goals",
          "/bella",
          "/reminders",
          "/account/",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
