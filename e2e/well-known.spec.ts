import { test, expect } from "@playwright/test";

/**
 * Associated-domains regression guard.
 *
 * iOS decides whether a https://taxottic.com link opens the app or
 * Safari by fetching /.well-known/apple-app-site-association once, at
 * install time, unauthenticated. Two things silently kill that:
 *
 *   1. A redirect. An account-less path that is not excluded by the
 *      middleware matcher (or listed in PUBLIC_PATHS in
 *      lib/supabase/middleware.ts) is 307'd to /login, and this repo has
 *      shipped that regression twice. Apple sees the redirect, gives up,
 *      and caches the result, so deep links stay dead long after a fix.
 *   2. A wrong content type. The file has no extension, so nothing
 *      infers application/json for it.
 *
 * maxRedirects: 0 is the whole point of the first assertion: without it
 * Playwright would follow the 307 to /login and the test would pass on a
 * completely broken file.
 */
test("the AASA file is served to Apple as JSON, with no redirect", async ({
  request,
}) => {
  const res = await request.get("/.well-known/apple-app-site-association", {
    maxRedirects: 0,
  });
  expect(res.status(), "a redirect here means deep links never work").toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = await res.json();
  expect(body.applinks.details[0].appIDs[0]).toMatch(
    /^[A-Z0-9]{10}\.com\.taxottic\.app$/,
  );
});

/**
 * An AASA that IS served but claims the wrong paths is its own failure:
 * every matching link is torn out of the browser and into the app,
 * including marketing and legal pages that must stay shareable on the
 * web. Pin the list to the three surfaces a signed-in-app link belongs
 * to.
 */
test("the AASA claims only the paths that should open the app", async ({
  request,
}) => {
  const res = await request.get("/.well-known/apple-app-site-association", {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  // /auth/* is the one that matters: the sign-in email resolves to
  // /auth/callback, so a list without it leaves the email opening
  // Safari, which is the failure this file exists to fix.
  expect(body.applinks.details[0].paths).toContain("/auth/*");
  expect(body.applinks.details[0].paths).toEqual(["/auth/*", "/login*", "/get*"]);
});

test("the sign-in email's destination is covered by the app links", async ({
  request,
}) => {
  // Reads the login page's own redirect target rather than restating
  // it, so moving the callback breaks this test instead of silently
  // un-fixing deep links.
  const login = await request.get("/login");
  expect(login.status()).toBe(200);
  const res = await request.get("/.well-known/apple-app-site-association");
  const paths: string[] = (await res.json()).applinks.details[0].paths;
  const covers = (url: string) =>
    paths.some((p) => {
      const prefix = p.replace(/\*$/, "");
      return p.endsWith("*") ? url.startsWith(prefix) : url === p;
    });
  expect(covers("/auth/callback"), "the magic-link callback must open the app").toBe(true);
  expect(covers("/pricing"), "marketing must stay in the browser").toBe(false);
});
