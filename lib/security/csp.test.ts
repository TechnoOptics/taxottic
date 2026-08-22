/**
 * The Content-Security-Policy must not allow-list a host we do not use.
 *
 * WHY THIS EXISTS. app/legal/cookies/page.tsx makes a published, legal
 * claim to users: no advertising cookies, no third-party tracking
 * pixels, no analytics SDK. That claim was true in the code and false
 * in the config. next.config.ts allow-listed
 * `https://*.vercel-insights.com` in both script-src and connect-src
 * while nothing in the tree imported @vercel/analytics or referenced
 * that host, so the header advertised a telemetry channel the product
 * had already removed.
 *
 * Nobody was collecting anything. That is exactly why it survived: an
 * unused allowance produces no traffic, no bug report and no test
 * failure. The only reader who would ever notice is someone auditing
 * our privacy page against our headers, which is to say a customer's
 * security reviewer, and the finding they would write up is "their
 * stated policy does not match their delivered policy".
 *
 * A CSP allow-list is a promise about where bytes may go. Keeping an
 * entry for a service that was removed means the promise is looser
 * than the one we published, and the gap can only be closed by someone
 * remembering. This test is that someone.
 *
 * Filesystem-only. It reads next.config.ts as text rather than
 * importing it, because importing a Next config pulls in the whole
 * build pipeline for what is a string assertion.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Hosts and packages that would contradict the published claim.
 * Deliberately not exhaustive: it names the vendors whose absence
 * app/legal/cookies/page.tsx asserts by name, so the test and the
 * page can be read against each other.
 */
const BANNED = [
  "vercel-insights",
  "vercel-analytics",
  "vitals.vercel",
  "google-analytics",
  "googletagmanager",
  "posthog",
  "segment.io",
  "cdn.segment",
  "mixpanel",
  "amplitude",
  "sentry",
  "plausible",
  "fathom",
  "logrocket",
  "hotjar",
  "fullstory",
  "clarity.ms",
] as const;

/**
 * The config with `//` and block comments removed.
 *
 * Load-bearing. This repository has repeatedly shipped guards that
 * matched their own explanatory comment and therefore asserted
 * nothing: a device-id test matched a comment naming ANDROID_ID, a
 * device-stall test matched a comment about self_check. The comment
 * directly above this test's subject names vercel-insights in prose,
 * so a naive substring search over the raw file would fail forever and
 * be "fixed" by deleting the comment.
 */
function configWithoutComments(): string {
  const raw = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** Every CSP directive string, as written in the config. */
function cspDirectives(): string[] {
  const src = configWithoutComments();
  const names = [
    "default-src",
    "script-src",
    "style-src",
    "img-src",
    "font-src",
    "connect-src",
    "frame-src",
    "frame-ancestors",
    "base-uri",
    "form-action",
    "object-src",
  ];
  const out: string[] = [];
  for (const line of src.split("\n")) {
    const m = line.match(/"([a-z-]+)\s+([^"]*)"/);
    if (m && names.includes(m[1])) out.push(`${m[1]} ${m[2]}`);
  }
  return out;
}

describe("Content-Security-Policy matches the published privacy claim", () => {
  // Guard the guard. If the regex above stops matching, every
  // assertion below passes vacuously over an empty array, which is the
  // exact failure mode vitest.config.ts documents for a glob that
  // matched no files: it looks like coverage.
  it("parses the directives out of next.config.ts", () => {
    const directives = cspDirectives();
    expect(directives.length).toBeGreaterThan(6);

    const names = directives.map((d) => d.split(" ")[0]);
    expect(names).toContain("script-src");
    expect(names).toContain("connect-src");

    // script-src really does list the vendors we do use, so a
    // directive parsed down to its bare name would not pass.
    const scriptSrc = directives.find((d) => d.startsWith("script-src")) ?? "";
    expect(scriptSrc).toContain("js.stripe.com");
    expect(scriptSrc.split(/\s+/).length).toBeGreaterThan(4);
  });

  it("allow-lists no analytics or telemetry host", () => {
    const directives = cspDirectives();
    const offenders: string[] = [];

    for (const directive of directives) {
      const lower = directive.toLowerCase();
      for (const banned of BANNED) {
        if (lower.includes(banned)) {
          offenders.push(`${directive.split(" ")[0]} allows ${banned}`);
        }
      }
    }

    expect(
      offenders,
      "app/legal/cookies/page.tsx tells users we run no analytics. " +
        "Adding one of these hosts to the CSP makes that page false. " +
        "If the product genuinely adds analytics, change the published " +
        "page and the consent banner first, then this list.",
    ).toEqual([]);
  });

  it("keeps the vendors the product actually uses", () => {
    // The inverse mistake is a zealous cleanup that strips a host the
    // app needs, which fails only in the browser, only in production,
    // and surfaces as an unrelated-looking error. next.config.ts
    // already records that exact debug detour for the Maps entries.
    const all = cspDirectives().join(" ");
    for (const required of [
      "js.stripe.com",
      "cdn.plaid.com",
      "maps.googleapis.com",
      "api.anthropic.com",
    ]) {
      expect(all, `${required} is required by shipped code`).toContain(required);
    }
  });
});
