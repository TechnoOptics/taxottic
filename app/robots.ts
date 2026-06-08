import type { MetadataRoute } from "next";
import { headers } from "next/headers";

/**
 * Host-aware robots.txt.
 *
 * The three Taxottic surfaces have very different crawl postures:
 *
 *  - `taxottic.com` (consumer marketing): aggressively crawlable.
 *    The marketing surface (`/`, `/pricing`, `/help`, `/changelog`,
 *    `/example`, `/legal/*`, `/book`) is intentionally indexable so
 *    we show up for "1099 tax software", "self-employed quarterly
 *    estimator", "Schedule C deductions", etc. App routes
 *    (`/dashboard`, `/c/*`, `/settings`, etc.) are explicitly
 *    disallowed: they redirect to /login when anonymous, so
 *    indexing them just bloats the index with empty login bounces
 *    and wastes crawl budget.
 *
 *  - `hq.taxottic.com` (super-admin cockpit): fully disallowed.
 *    Operator surface; nothing here should ever appear in a search
 *    result. We use a blanket `Disallow: /`. No sitemap.
 *
 *  - `enterprise.taxottic.com` (firm-operator console): fully
 *    disallowed. Same rationale as HQ — the firms console is for
 *    paying firm operators, not search visibility. No sitemap.
 *
 * Reading the request host via `headers()` is what makes this
 * dynamic. Without that, Next.js would emit ONE robots.txt at build
 * time and the same content would be served from all three hosts —
 * which would either expose the admin paths under taxottic.com's
 * sitemap, or hide marketing under a blanket disallow. Neither is
 * acceptable. The cost is making `/robots.txt` a dynamic route, which
 * is fine: it's tiny, cached at the edge, and almost never the
 * critical path.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host")?.toLowerCase() ?? "";
  const isAdminHost =
    host === "hq.taxottic.com" || host === "enterprise.taxottic.com";

  // Anchor sitemap + canonical at the production origin regardless of
  // which host receives the robots.txt request. The consumer origin
  // is the only host that has a real public sitemap.
  const consumerOrigin =
    process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://taxottic.com";

  if (isAdminHost) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
      // Deliberately no `sitemap` or `host` field — admin hosts don't
      // advertise a sitemap to anyone.
    };
  }

  // Shared crawl policy. The marketing surface is intentionally
  // indexable; app routes redirect to /login when anonymous and carry
  // per-account content, so they're disallowed (zero SEO value, wasted
  // crawl budget).
  const allow = [
    "/",
    "/pricing",
    "/help",
    // Editorial guides — real, indexable content written to rank for
    // "self-employment tax", "Schedule C deductions", "quarterly
    // estimated taxes", and to give AI assistants something to cite.
    "/guides",
    "/changelog",
    "/example",
    "/book",
    "/firms",
    "/legal",
  ];
  const disallow = [
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
    "/firm",
    // Soft-toggle query variants — canonical resolves them back to `/`,
    // but the path-form disallow keeps crawlers from chasing arbitrary
    // `?audience=...` URLs in pagination.
    "/*?audience=",
  ];

  // Explicitly welcome the major AI / answer-engine crawlers on the
  // public surface (same allow/disallow as everyone else). Taxottic
  // WANTS these bots to read the marketing pages + guides so assistants
  // can describe and cite the product accurately — so we name them
  // rather than leaving it implicit under `*`.
  const aiAgents = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-Web",
    "anthropic-ai",
    "PerplexityBot",
    "Google-Extended",
    "Applebot-Extended",
    "CCBot",
  ];

  return {
    rules: [
      { userAgent: "*", allow, disallow },
      ...aiAgents.map((userAgent) => ({ userAgent, allow, disallow })),
    ],
    sitemap: `${consumerOrigin}/sitemap.xml`,
    host: consumerOrigin,
  };
}
