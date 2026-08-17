import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { settleWithinBudget } from "./finalize-freshness";

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
