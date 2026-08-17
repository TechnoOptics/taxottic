import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  RENDER_FRESHNESS_WINDOW_MS,
  settleWithinBudget,
} from "./finalize-freshness";

/**
 * THE BUG.
 *
 * /mileage renders fast by racing finalize against a 2.5s timer. But
 * Promise.race does not cancel the loser: when finalize is slow the page
 * renders WITHOUT the new drive, finalize lands a moment later, and the
 * drive only appears on the NEXT render. The user's report is exactly that
 * shape, "load the page, nothing new; tap any control and the drive is
 * there". That tap was showing them the previous load's finalize result.
 *
 * The fix is not a longer timeout (that trades a stale list for a slow
 * page) and not polling. It is: keep the fast render, but tell the client
 * that finalize was STILL OUTSTANDING, so it can wait for that one run and
 * refresh exactly once. When finalize finished inside the budget the page
 * is already correct and the client must do nothing at all, or every page
 * load pays for a second render it did not need.
 *
 * `settleWithinBudget` is the half of that which can be tested without a
 * database: did the work finish inside the budget, yes or no.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("settleWithinBudget", () => {
  it("reports finished when the work resolves inside the budget", async () => {
    vi.useFakeTimers();
    const work = new Promise((resolve) => setTimeout(resolve, 100));
    const p = settleWithinBudget(work, 2_500);
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toEqual({ finished: true });
  });

  it("reports NOT finished when the budget expires first", async () => {
    vi.useFakeTimers();
    // Never settles inside the budget: the slow-finalize case that puts a
    // stale list on screen.
    const work = new Promise((resolve) => setTimeout(resolve, 10_000));
    const p = settleWithinBudget(work, 2_500);
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(p).resolves.toEqual({ finished: false });
  });

  it("does not wait for the budget once the work is done", async () => {
    vi.useFakeTimers();
    const p = settleWithinBudget(Promise.resolve(), 2_500);
    // No timer advance at all. If the implementation awaited the timer it
    // would hang here and the test would time out.
    await expect(p).resolves.toEqual({ finished: true });
    // And the timer must be cleared, not merely ignored: a stray pending
    // timer keeps the serverless invocation's event loop busy.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a failed run as finished, because nothing is outstanding", async () => {
    // finalize threw. There is no late write coming, so asking the client
    // to wait and refresh would buy a second render for nothing.
    await expect(
      settleWithinBudget(Promise.reject(new Error("boom")), 2_500),
    ).resolves.toEqual({ finished: true });
  });

  it("never rejects, however the run failed", async () => {
    // The caller is a server component rendering a page. A freshness pass
    // that blew up must degrade to "render what we have", never to an
    // error page for somebody who only opened their drive log.
    await expect(
      settleWithinBudget(Promise.reject(new Error("x")), 5),
    ).resolves.toEqual({ finished: true });

    let fail: (e: Error) => void = () => {};
    const late = new Promise((_, reject) => {
      fail = reject;
    });
    const p = settleWithinBudget(late, 5);
    await expect(p).resolves.toEqual({ finished: false });
    // Failing after the budget has already expired must not turn the
    // settled result into a throw either.
    fail(new Error("late failure"));
    await expect(p).resolves.toEqual({ finished: false });
  });
});

// ---------------------------------------------------------------------
// Wiring. The helper being correct is worth nothing if the page still
// races a bare timer, or if the client refresh is never rendered.
// ---------------------------------------------------------------------

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\/[^\n]*\n/g, "{\n")
    .replace(/\/\/[^\n]*/g, "");
}

function code(path: string): string {
  const src = stripComments(readFileSync(path, "utf8"));
  expect(src.length).toBeGreaterThan(300);
  return src;
}

describe("the stale-list fix is wired into /mileage", () => {
  const page = () => code("app/mileage/page.tsx");

  it("the page no longer races a raw setTimeout against finalize", () => {
    const src = page();
    expect(src).not.toContain("Promise.race");
    expect(src).toContain("settleWithinBudget");
  });

  it("the page renders the refresh only when finalize was outstanding", () => {
    const src = page();
    // Rendered unconditionally, every single page load pays for a second
    // render. The gate is the whole point.
    expect(src).toMatch(/finalizeOutstanding\s*\?/);
    expect(src).toContain("FinalizeSettleRefresh");
    expect(src).toMatch(/finalizeOutstanding\s*=\s*!finished/);
  });

  it("the client refreshes ONCE, and does not poll", () => {
    const src = code("components/mileage/FinalizeSettleRefresh.tsx");
    expect(src).toContain("router.refresh()");
    expect(src.match(/router\.refresh\(\)/g) ?? []).toHaveLength(1);
    // No loop of any kind. A poll would hammer finalize from every phone
    // sitting on this page.
    expect(src).not.toContain("setInterval");
    expect(src).not.toMatch(/\bwhile\s*\(/);
    expect(src).not.toMatch(/\bfor\s*\(/);
    // Fire-once gate, so a refresh round trip cannot re-trigger it.
    expect(src).toContain("useRef");
    expect(src).toMatch(/if\s*\(\s*\w+\.current\s*\)\s*return/);
  });

  it("the settle endpoint awaits finalize to completion", () => {
    const src = code("app/api/mileage/finalize/route.ts");
    expect(src).toContain("finalizeUserTrips");
    expect(src).toContain("await");
    // No timeout here: this route exists precisely to wait it out.
    expect(src).not.toContain("setTimeout");
    // Same never-sever-an-open-drive contract the page render uses.
    expect(src).toMatch(/forceClose:\s*false/);
  });
});

// ---------------------------------------------------------------------
// THE SECOND BUG, the one the refresh signal did NOT fix.
//
// The stale-list symptom was cured, but the render STALL was not. The
// page still hands finalize a 7-day window, and finalize's first act is
// to page the whole unconsumed staging pool for that window out of
// PostgREST 1000 rows at a time. Raw points that never become a trip
// (parked, sub-threshold, noise) are never marked consumed, so that pool
// does not shrink: it is permanent residue that every single render
// re-fetches. Measured on the owner's live account: 6,743 rows over 7
// sequential HTTP pages, 1.1-1.5s, producing nothing.
//
// The render path is the THIRD line of defence behind two that already
// cover this data far better:
//   - /api/mileage/ingest finalizes a 24h window on every upload
//   - the mileage-finalize cron finalizes a 45-day window every 10 min
// So the only gap a render can close is a drive that landed since the
// last cron tick. A window measured in hours closes that gap; a 7-day
// window just re-reads a week of residue on every page load.
//
// These tests pin the window to the narrow one AND pin the ordering
// against the two paths that back it up, so widening it back, or
// narrowing the cron below it, fails here.
// ---------------------------------------------------------------------

/**
 * Every FINALIZE window in a comment-stripped source, in ms.
 *
 * Two things this helper is careful about, both learned by getting them
 * wrong first:
 *
 * 1. The window expression is CAPTURED and evaluated, never pattern
 *    matched against an expected literal. A draft that baked
 *    "45 * 24 * 60 * 60_000" into the regex would have responded to a
 *    narrowed window by failing to match, reporting a missing marker
 *    rather than the narrowing the guard exists to catch.
 *
 * 2. It is anchored to `sinceIso`, the argument finalize actually
 *    receives. A draft that took the narrowest `Date.now() - ...` in the
 *    whole file picked up the cron's unrelated device-status and
 *    escalation windows and measured those instead.
 */
function finalizeWindowsMsIn(path: string): number[] {
  const src = code(path);
  const found = [
    ...src.matchAll(
      /\bsinceIso\s*[:=]\s*new Date\(\s*Date\.now\(\)\s*-\s*([0-9_]+(?:\s*\*\s*[0-9_]+)*)/g,
    ),
  ].map((m) => Function(`"use strict";return (${m[1]})`)() as number);
  expect(found.length).toBeGreaterThan(0);
  return found;
}

/**
 * The NARROWEST finalize window a source uses, which is the honest
 * bound: a backstop covers the render path only as well as its tightest
 * sweep does.
 */
function narrowestWindowMsIn(path: string): number {
  return Math.min(...finalizeWindowsMsIn(path));
}

describe("the render-path freshness window is the narrowest of the three", () => {
  it("the page renders with the narrow window constant, not an inline 7 days", () => {
    const src = code("app/mileage/page.tsx");
    expect(src).toContain("RENDER_FRESHNESS_WINDOW_MS");
    // The literal that cost 1.1-1.5s a render must be gone from the call.
    expect(src).not.toMatch(/sinceIso:[\s\S]{0,80}7\s*\*\s*86_400_000/);
  });

  it("is shorter than the ingest window, which finalizes on every upload", () => {
    const ingest = narrowestWindowMsIn("app/api/mileage/ingest/route.ts");
    expect(RENDER_FRESHNESS_WINDOW_MS).toBeLessThan(ingest);
  });

  it("is far shorter than the cron window, which is the real backstop", () => {
    const cron = narrowestWindowMsIn(
      "app/api/cron/mileage-finalize/route.ts",
    );
    expect(RENDER_FRESHNESS_WINDOW_MS).toBeLessThan(cron);
    // Not merely shorter: the cron must cover it many times over, so a
    // render that skips a drive is always picked up within a tick or two.
    expect(cron / RENDER_FRESHNESS_WINDOW_MS).toBeGreaterThan(24);
  });

  it("still spans many cron ticks, so a missed tick cannot strand a drive", () => {
    // The cron runs every 10 minutes (vercel.json). The render window has
    // to be comfortably wider than that gap or it stops being a useful
    // third line of defence at all.
    const CRON_TICK_MS = 10 * 60_000;
    expect(RENDER_FRESHNESS_WINDOW_MS / CRON_TICK_MS).toBeGreaterThanOrEqual(12);
  });

  it("is measured in hours, not days", () => {
    expect(RENDER_FRESHNESS_WINDOW_MS).toBeGreaterThanOrEqual(60 * 60_000);
    expect(RENDER_FRESHNESS_WINDOW_MS).toBeLessThanOrEqual(12 * 60 * 60_000);
  });
});

describe("the settle endpoint finishes the SAME run the render started", () => {
  it("shares the render window rather than restating it", () => {
    const src = code("app/api/mileage/finalize/route.ts");
    expect(src).toContain("RENDER_FRESHNESS_WINDOW_MS");
    // A restated literal is how the two drifted apart before.
    expect(src).not.toMatch(/7\s*\*\s*86_400_000/);
  });
});
