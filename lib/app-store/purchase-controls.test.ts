/**
 * Every purchase control is behind the native check.
 *
 * WHY THIS FILE EXISTS
 *
 * The iOS app (App Store ID 6767039803) is a Capacitor WebView over
 * taxottic.com. Subscriptions and credit packs run through Stripe, not
 * Apple In-App Purchase, so the app relies on App Store Review
 * Guideline 3.1.3(f) "Free Stand-alone Apps": a free companion to a paid
 * web tool needs no IAP "provided there is no purchasing inside the
 * app". Guideline 3.1.1 otherwise requires IAP for anything that
 * unlocks features, and there is no IAP here to fall back on.
 *
 * The MECHANISM for that already exists and is correct: <WebOnly>
 * renders its children only in a browser, and useIsNativeApp() returns
 * null until the platform is known so a buy button never flashes.
 * What decays is COVERAGE. A new upgrade button lands on a page nobody
 * remembered to gate, and it ships. That has already happened: the
 * /billing auto-top-up form, the settings "Open billing" link, the
 * Bella paywall card, the personal upgrade page CTA, and the firm
 * Stripe-portal link all rendered in the native shell.
 *
 * So this file is not an audit. It is the thing that outlives the
 * audit: it re-derives the inventory from source on every run and fails
 * when a new purchase control appears outside the gate.
 *
 * WHAT COUNTS AS A PURCHASE CONTROL
 *
 * A control that, if tapped inside the app, starts or manages a payment:
 *   - a route to /billing (the purchase page)
 *   - a route to a Stripe Checkout / Customer Portal endpoint
 *   - the <CheckoutButton> / <ManageBillingButton> components
 *   - a form bound to the auto-top-up server action (it authorises
 *     recurring charges, so it is a purchase mechanism, not a link)
 *
 * Deliberately NOT counted: plain text telling the user that plans live
 * at taxottic.com. Those are outside-the-app calls to action, which the
 * United States storefront permits (guideline 3.1.1(a): the external
 * link entitlement "is not required for developers to include buttons,
 * external links, or other calls to action in their United States
 * storefront apps"). This app is US-storefront only. The in-app
 * purchase MECHANISM is the part no storefront carve-out excuses, so
 * that is the line this guard draws.
 *
 * WHY THE ANALYSER IS TESTED TOO
 *
 * Seven guards in this repo have shipped green while matching only
 * their own doc comment, and one read as coverage while being blind to
 * a whole class of call site. So `analyse` below is exercised against
 * synthetic sources with known answers ("the analyser is not blind"),
 * and the repo scan is a separate describe block. If the parser stops
 * understanding JSX, the synthetic tests fail loudly instead of the
 * repo scan quietly reporting zero violations.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const SCANNED = ["app", "components"];

/**
 * Components that gate themselves internally (`if (isNative !== false)
 * return null`) rather than being wrapped by a caller. Their own
 * gating is asserted separately below, so a call site is allowed to
 * render them unwrapped.
 */
const SELF_GATING = ["CheckoutButton", "ManageBillingButton"] as const;

/** Routes that start or manage a Stripe payment. */
const PURCHASE_ROUTES = [
  "/billing",
  "/api/stripe/checkout",
  "/api/stripe/portal",
  "/api/firm/billing/portal",
];

/** Server actions that authorise a charge. */
const PURCHASE_ACTIONS = ["setAutoTopUpAction"];

/** Strip comments. A control described in prose is not a control. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<!:)\/\/[^\n]*/g, "");
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec|ct\.spec|ct\.fixture)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Byte ranges of `<WebOnly ...>...</WebOnly>` that actually protect
 * their contents on native, MINUS the `fallback={...}` prop, whose
 * contents are exactly what DOES render on native. A purchase control
 * parked in a fallback is a violation, not a fix, and missing that
 * distinction is how a guard reads as coverage while being blind.
 */
function protectedRanges(src: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const open = /<WebOnly(\s|>|\/)/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(src))) {
    const start = m.index;
    const close = src.indexOf("</WebOnly>", start);
    if (close === -1) continue;
    const end = close + "</WebOnly>".length;
    const holes = fallbackRanges(src, start, end);
    let cursor = start;
    for (const [hs, he] of holes) {
      if (hs > cursor) ranges.push([cursor, hs]);
      cursor = he;
    }
    if (cursor < end) ranges.push([cursor, end]);
  }
  return ranges;
}

/** Extent of every `fallback={...}` prop inside [from, to), brace-balanced. */
function fallbackRanges(src: string, from: number, to: number): Array<[number, number]> {
  const holes: Array<[number, number]> = [];
  const prop = /fallback\s*=\s*\{/g;
  prop.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = prop.exec(src)) && m.index < to) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < to; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    holes.push([m.index, Math.min(i + 1, to)]);
    prop.lastIndex = i + 1;
  }
  return holes;
}

/**
 * A render helper whose every call site sits inside a protected range
 * is itself protected. TrialBanner does this: the two /billing links
 * live in `renderBanner()`, which is only ever called from inside
 * `<WebOnly>{renderBanner(trial)}</WebOnly>`.
 *
 * Without this the guard would report a false positive there, and a
 * false positive is how a guard gets exemption-listed and then stops
 * meaning anything. It generalises too: pulling a purchase control out
 * into a helper is exactly the indirection that would otherwise hide a
 * real gap, and here it stays visible, because a helper called from
 * ANYWHERE unprotected still reports.
 */
function helperRanges(
  src: string,
  safe: Array<[number, number]>,
): Array<[number, number]> {
  const inSafe = (i: number) => safe.some(([a, b]) => i >= a && i < b);
  const extra: Array<[number, number]> = [];
  const decl = /^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(src))) {
    const name = m[1];
    const body = balancedBody(src, m.index);
    if (!body) continue;
    const calls = [...src.matchAll(new RegExp(`\\b${name}\\s*\\(`, "g"))]
      .map((c) => c.index!)
      .filter((i) => i < body[0] || i >= body[1]);
    if (calls.length > 0 && calls.every(inSafe)) extra.push(body);
  }
  return extra;
}

/** [start, end) of the brace-balanced body of the declaration at `from`. */
function balancedBody(src: string, from: number): [number, number] | null {
  // Skip the parameter list by balancing parens: a param's TYPE can
  // contain braces (`Extract<T, { kind: "x" }>`), and taking the first
  // `{` after `(` lands inside the type instead of the body. That bug
  // made this helper analysis silently do nothing.
  let p = src.indexOf("(", from);
  if (p === -1) return null;
  let pd = 0;
  for (; p < src.length; p++) {
    if (src[p] === "(") pd++;
    else if (src[p] === ")") {
      pd--;
      if (pd === 0) break;
    }
  }
  const open = src.indexOf("{", p);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return [from, i + 1];
    }
  }
  return null;
}

export type Finding = { control: string; line: number };

/**
 * Layer A, precise: every purchase control in `src` that is NOT inside
 * a protecting <WebOnly> range. Matches the rendered attribute, so it
 * can name the exact line. Operates on comment-stripped source.
 */
function analyse(rawSrc: string): Finding[] {
  const src = stripComments(rawSrc);
  const direct = protectedRanges(src);
  const safe = [...direct, ...helperRanges(src, direct)];
  const isProtected = (i: number) => safe.some(([a, b]) => i >= a && i < b);
  const lineOf = (i: number) => src.slice(0, i).split("\n").length;

  const seen = new Set<number>();
  const findings: Finding[] = [];
  const record = (re: RegExp, label: string) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (isProtected(m.index) || seen.has(m.index)) continue;
      seen.add(m.index);
      findings.push({ control: label, line: lineOf(m.index) });
    }
  };

  for (const route of PURCHASE_ROUTES) {
    const r = route.replace(/\//g, "\\/");
    // href={`/x`} | href="/x" | action='/x'. The tappable control.
    record(
      new RegExp(`(?:href|action)\\s*=\\s*\\{?\\s*[\`"']${r}(?![a-z0-9-])`, "g"),
      `route ${route}`,
    );
  }
  for (const action of PURCHASE_ACTIONS) {
    record(
      new RegExp(`action\\s*=\\s*\\{\\s*${action}\\s*\\}`, "g"),
      `action ${action}`,
    );
  }
  return findings.sort((a, b) => a.line - b.line);
}

/**
 * Layer B, catch-all: does this source mention a purchase route at all?
 *
 * Layer A only sees a route written directly into the attribute. A file
 * can just as easily park it in a variable and render `href={href}`,
 * ProGate does exactly that today. Resolving variables properly means
 * writing a type checker, so instead: any .tsx that mentions a purchase
 * route ANYWHERE must also carry the native check. That is coarse on
 * purpose. It cannot say which line is wrong, but it cannot be dodged
 * by indirection either, and a file with no gate at all is the failure
 * mode that actually ships.
 */
function mentionsPurchaseRoute(rawSrc: string): boolean {
  const src = stripComments(rawSrc);
  return PURCHASE_ROUTES.some((route) =>
    new RegExp(`[\`"']${route.replace(/\//g, "\\/")}(?![a-z0-9-])`).test(src),
  );
}

function carriesNativeCheck(rawSrc: string): boolean {
  const src = stripComments(rawSrc);
  return /\bWebOnly\b/.test(src) || /\buseIsNativeApp\b/.test(src);
}

// ---------------------------------------------------------------------
// 1. The analyser is not blind.
// ---------------------------------------------------------------------

describe("the purchase-control analyser sees what it claims to see", () => {
  it("reports a bare upgrade link", () => {
    const src = `<Link href="/billing" className="btn-primary">See plans</Link>`;
    expect(analyse(src).map((f) => f.control)).toEqual(["route /billing"]);
  });

  it("reports a link with a query string", () => {
    const src = `<Link href="/billing?plan=solo&for=personal">See personal plans</Link>`;
    expect(analyse(src)).toHaveLength(1);
  });

  it("reports a Stripe customer-portal link", () => {
    const src = "<Link href={`/api/firm/billing/portal`}>Manage billing</Link>";
    expect(analyse(src).map((f) => f.control)).toEqual([
      "route /api/firm/billing/portal",
    ]);
  });

  it("reports a form bound to the auto-top-up action", () => {
    const src = `<form action={setAutoTopUpAction}><button>Save</button></form>`;
    expect(analyse(src).map((f) => f.control)).toEqual([
      "action setAutoTopUpAction",
    ]);
  });

  it("clears a link wrapped in WebOnly", () => {
    const src = `<WebOnly><Link href="/billing">See plans</Link></WebOnly>`;
    expect(analyse(src)).toEqual([]);
  });

  it("still reports a link parked in a WebOnly fallback, which is what native renders", () => {
    const src = `<WebOnly fallback={<Link href="/billing">Upgrade</Link>}><span /></WebOnly>`;
    expect(analyse(src)).toHaveLength(1);
  });

  it("clears a plain-text fallback that names the website without a route", () => {
    const src = `<WebOnly fallback={<p>Manage your plan at taxottic.com.</p>}><Link href="/billing">Plans</Link></WebOnly>`;
    expect(analyse(src)).toEqual([]);
  });

  it("does not count a purchase route named only in a comment", () => {
    const src = `// the upgrade CTA links to href="/billing", web only\n<span />`;
    expect(analyse(src)).toEqual([]);
  });

  it("catches a purchase route hidden behind a variable, which layer A cannot see", () => {
    const src = `const target = "/billing";\n<Link href={target}>Upgrade</Link>`;
    // Layer A is blind to this by construction: the attribute holds an
    // identifier, not a route. Layer B is what catches it.
    expect(analyse(src)).toEqual([]);
    expect(mentionsPurchaseRoute(src)).toBe(true);
    expect(carriesNativeCheck(src)).toBe(false);
  });

  it("accepts a variable-held route in a file that does carry the gate", () => {
    const src = `import { WebOnly } from "@/components/WebOnly";\nconst target = "/billing";`;
    expect(mentionsPurchaseRoute(src)).toBe(true);
    expect(carriesNativeCheck(src)).toBe(true);
  });

  it("does not count a native check that appears only in a comment", () => {
    const src = `// this is fine, WebOnly covers it\nconst target = "/billing";`;
    expect(carriesNativeCheck(src)).toBe(false);
  });

  it("does not mistake an unrelated route for a purchase route", () => {
    const src = `<Link href="/billing-history-export">Export</Link><Link href="/settings">Settings</Link>`;
    expect(analyse(src)).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// 2. The repo has no ungated purchase control.
// ---------------------------------------------------------------------

const ALL_FILES = SCANNED.flatMap((d) => sourceFiles(join(REPO_ROOT, d)));
const rel = (f: string) => f.slice(REPO_ROOT.length + 1);

describe("no purchase control renders inside the native app", () => {
  it("scans a non-trivial number of files, so a broken glob cannot read as coverage", () => {
    expect(ALL_FILES.length).toBeGreaterThan(100);
  });

  it("finds no purchase route or charge-authorising form outside <WebOnly>", () => {
    const violations: string[] = [];
    for (const file of ALL_FILES) {
      // The self-gating components hold their own purchase fetch calls;
      // their gate is asserted in the next test instead.
      if (SELF_GATING.some((c) => rel(file).endsWith(`components/${c}.tsx`))) {
        continue;
      }
      for (const f of analyse(readFileSync(file, "utf8"))) {
        violations.push(`${rel(file)}:${f.line} ${f.control}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("gives every .tsx that mentions a purchase route the native check", () => {
    // Catch-all for the class layer A cannot reach. A file that routes
    // to checkout through a variable, a prop, a config object or a
    // router.push still has to carry the gate. Coarse by design: it
    // cannot say which line is wrong, but it cannot be dodged by
    // indirection, and "no gate anywhere in the file" is the failure
    // mode that actually ships.
    const ungated: string[] = [];
    for (const file of ALL_FILES) {
      if (!file.endsWith(".tsx")) continue;
      const src = readFileSync(file, "utf8");
      if (mentionsPurchaseRoute(src) && !carriesNativeCheck(src)) {
        ungated.push(rel(file));
      }
    }
    expect(ungated).toEqual([]);
  });

  it("keeps every self-gating purchase component gated on the native check", () => {
    for (const name of SELF_GATING) {
      const src = stripComments(
        readFileSync(join(REPO_ROOT, "components", `${name}.tsx`), "utf8"),
      );
      expect(src, `${name} must read the platform`).toContain("useIsNativeApp");
      // `isNative !== false` and not `isNative === true`: the null
      // (undetermined) state must render nothing too, so the control
      // never flashes before the platform is known.
      expect(src, `${name} must render nothing until the platform is known`).toMatch(
        /if\s*\(\s*isNative\s*!==\s*false\s*\)\s*return null/,
      );
    }
  });

  it("keeps WebOnly itself failing closed while the platform is unknown", () => {
    const src = stripComments(
      readFileSync(join(REPO_ROOT, "components", "WebOnly.tsx"), "utf8"),
    );
    expect(src).toMatch(/if\s*\(\s*isNative\s*===\s*null\s*\)\s*return null/);
    expect(src).toMatch(/isNative\s*\?\s*<>\{fallback\}<\/>\s*:\s*<>\{children\}<\/>/);
  });
});

describe("the file walker", () => {
  // A component-test FIXTURE is test scaffolding: it never ships, and it
  // legitimately mounts the real billing surfaces to photograph them.
  // Found 2026-09-03: a dashboard fixture that mounted TrialBanner and a
  // /billing link tripped this guard and lib/hq/invisibility.test.ts,
  // and the next person to add a fixture will hit the same wall unless
  // the walker knows the difference. The test below pins it with two
  // synthetic files so that neither the skip nor the scan can rot
  // silently: a fixture must be ignored, a same-named component must not.
  it("skips *.ct.fixture.tsx but still scans a real component", () => {
    const dir = mkdtempSync(join(tmpdir(), "purchase-walker-"));
    try {
      writeFileSync(join(dir, "Thing.ct.fixture.tsx"), 'export const a = "/billing";\n');
      writeFileSync(join(dir, "Thing.ct.spec.tsx"), 'export const b = "/billing";\n');
      writeFileSync(join(dir, "Thing.tsx"), 'export const c = "/billing";\n');
      const found = sourceFiles(dir).map((f) => basename(f));
      expect(found).toEqual(["Thing.tsx"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
