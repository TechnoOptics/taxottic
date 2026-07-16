import { test, expect } from "@playwright/test";

/**
 * Public-route regression guard.
 *
 * The /calculators and /compare trees shipped a silent regression: real,
 * indexable pages that the middleware 307-redirected to /login for every
 * anonymous visitor and search crawler, because their prefixes were
 * missing from PUBLIC_PATHS (lib/supabase/middleware.ts). The whole
 * free-tool + SEO funnel was invisible, and the existing marketing e2e
 * didn't cover it.
 *
 * This closes the gap at the source: pull the live sitemap and assert
 * EVERY advertised URL returns 200 for an anonymous request. A future
 * public route that falls behind the auth gate fails here, named.
 *
 * The `request` fixture carries no auth state (no storageState in the
 * config), so these hits are genuinely anonymous.
 */
test.describe("Public routes stay public", () => {
  test("every sitemap URL returns 200 for an anonymous visitor", async ({
    request,
  }) => {
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status(), "/sitemap.xml must be publicly 200").toBe(200);

    const xml = await sitemap.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(
      locs.length,
      "sitemap should advertise a meaningful number of URLs",
    ).toBeGreaterThan(10);

    // <loc> entries are absolute (prod origin); test the PATH against the
    // configured baseURL. Dedupe (query-string variants collapse to path).
    const paths = [...new Set(locs.map((u) => new URL(u).pathname))];

    // The middleware gates by top-level PREFIX (PUBLIC_PATHS `startsWith`),
    // so the 51 /calculators/self-employment-tax/<state> URLs all exercise
    // the same branch. Sample up to 3 paths per first path segment: every
    // prefix is still covered (a missing-prefix regression fails), but the
    // suite stays fast even against a dev server that compiles on demand.
    const byPrefix = new Map<string, string[]>();
    for (const p of paths) {
      const prefix = "/" + (p.split("/")[1] ?? "");
      const arr = byPrefix.get(prefix) ?? [];
      if (arr.length < 3) arr.push(p);
      byPrefix.set(prefix, arr);
    }
    // The incident routes must actually be advertised, so this guard can't
    // pass trivially by their absence from the sitemap.
    for (const critical of ["/calculators", "/compare", "/guides"]) {
      expect(
        byPrefix.has(critical),
        `${critical} is missing from the sitemap entirely`,
      ).toBe(true);
    }

    const sample = [...byPrefix.values()].flat();

    // Anonymous GET each, WITHOUT following redirects, so a 307 → /login
    // surfaces as a failure instead of being silently followed to a 200.
    const failures: string[] = [];
    const BATCH = 8;
    for (let i = 0; i < sample.length; i += BATCH) {
      const results = await Promise.all(
        sample.slice(i, i + BATCH).map(async (p) => {
          const res = await request.get(p, { maxRedirects: 0 });
          return { p, status: res.status(), loc: res.headers()["location"] ?? "" };
        }),
      );
      for (const r of results) {
        if (r.status !== 200) {
          failures.push(`${r.status} ${r.p}${r.loc ? ` → ${r.loc}` : ""}`);
        }
      }
    }

    expect(
      failures,
      `These sitemap URLs are NOT public for anonymous visitors. A "307 → /login" means the route's prefix is missing from PUBLIC_PATHS in lib/supabase/middleware.ts:\n  ${failures.join("\n  ")}\n`,
    ).toEqual([]);
  });

  /**
   * The install link is noindex on purpose (a share link, not an SEO
   * surface), so the sitemap sweep above can never cover it. It still
   * has to be anonymous-200: every person who receives /get has no
   * account yet, and a 307 to /login would silently break every link
   * we have handed to a tester. Guard it by name.
   */
  test("/get stays anonymous-reachable for testers", async ({ request }) => {
    const res = await request.get("/get", { maxRedirects: 0 });
    expect(
      res.status(),
      `/get must be 200 for anonymous visitors, got ${res.status()} -> ${
        res.headers()["location"] ?? "no location"
      }. Check PUBLIC_PATHS in lib/supabase/middleware.ts.`,
    ).toBe(200);
  });
});
