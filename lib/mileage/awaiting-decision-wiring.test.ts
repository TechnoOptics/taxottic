import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * THE INVARIANT: the number the drive log shows and the queue that
 * number sends the driver to are computed from the SAME rule, and that
 * rule is lib/mileage/awaiting-decision.ts.
 *
 * This is a call-site test because a correct module with the wrong
 * caller is this repo's default failure. `countDrivesAwaitingDecision`
 * passes its own unit tests whether or not /mileage ever calls it, and
 * whether or not /mileage/classify can act on what it counts. A pill
 * promising five drives that lands on a deck holding none, and bouncing
 * the driver straight back, is worse than the bug it replaced.
 *
 * Comments are stripped before every assertion. This repo has shipped
 * guards that matched their own doc comment while the code did something
 * else, and both files under test name these symbols in prose.
 */

const MILEAGE_PAGE = "app/mileage/page.tsx";
const CLASSIFY_PAGE = "app/mileage/classify/page.tsx";
const AUTO_REFRESH = "components/mileage/MileageAutoRefresh.tsx";

/**
 * Strip block comments, JSX comment expressions and line comments,
 * INCLUDING line comments trailing real code.
 *
 * The trailing case is not pedantry. Verified against this very file: a
 * guard asserting the page renders `<MileageAutoRefresh />` stayed green
 * when the element was deleted and the same text left behind as a
 * trailing `// ...` note. A stripper that only handles whole-line
 * comments cannot see that, and every positive assertion here rests on
 * it. The `:` lookbehind keeps a `https://` inside a string literal from
 * being mistaken for the start of a comment.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(?<!:)\/\/[^\n]*/g, "");
}

const page = stripComments(readFileSync(MILEAGE_PAGE, "utf8"));
const classify = stripComments(readFileSync(CLASSIFY_PAGE, "utf8"));
const autoRefresh = stripComments(readFileSync(AUTO_REFRESH, "utf8"));

describe("the drive log counts every drive awaiting a decision", () => {
  it("asks awaiting-decision for the number", () => {
    expect(page).toMatch(/countDrivesAwaitingDecision\s*\(/);
  });

  it("shows the persistent control and the banner off that number, not off unclassified alone", () => {
    // The defect in one line. `classification === "unclassified"` was the
    // only input to both surfaces, so sixteen production drives carrying
    // needs_confirmation were absent from every count on the page while
    // #616 held them out of the deduction.
    const unclassifiedOnly = /classification === "unclassified"\s*,?\s*\)\.length/;
    expect(
      unclassifiedOnly.test(page),
      "the page still derives a displayed count from unclassified alone",
    ).toBe(false);
  });

  it("hands that number to the head, and the head alone", () => {
    /**
     * THIS RULE WAS DELIBERATELY REVERSED, and the reversal is the point.
     *
     * It used to read "keeps the control on screen when the count is
     * zero": a persistent pill, present at zero as much as at fifty, so
     * a driver could learn where the review queue lived. That was
     * correct while the only place to settle a drive was a separate
     * deck. It is not correct now. Every row carries a business-or-
     * personal control backed by a server action, so the screen asked
     * the same question three times before the reader reached a drive:
     * an amber card, this pill, and a "Need review" stat below the list.
     * The owner's words were "messy and not user friendly".
     *
     * So the head states the count when there is one and says nothing
     * when there is not, and the rows do the asking. What still has to
     * hold is that the number the head shows is THIS number: the
     * range-independent count over both undecided states, not a
     * recount from the loaded page.
     */
    const at = page.indexOf("<MilesHead");
    expect(at, "the head is not rendered").toBeGreaterThan(-1);
    const tag = page.slice(at, page.indexOf("/>", page.indexOf("tracking=", at)));
    expect(tag, "the head is not given the waiting count").toMatch(
      /awaiting=\{[^}]*awaitingCount/,
    );
    expect(
      page,
      "the count is derived from the loaded page rather than the indexed read",
    ).toMatch(/const awaitingCount = awaitingDecision/);
  });
});

describe("the review deck can act on everything the count promises", () => {
  it("applies the shared filter instead of its own", () => {
    expect(classify).toMatch(/applyAwaitingDecisionFilter\s*\(/);
  });

  it("no longer hard-codes the unclassified-only query", () => {
    // This exact call is what made the deck redirect to
    // /mileage?caughtup=1 for a driver holding five flagged drives.
    expect(
      /\.eq\(\s*["']classification["']\s*,\s*["']unclassified["']\s*\)/.test(
        classify,
      ),
      "the deck still selects unclassified rows only",
    ).toBe(false);
  });
});

describe("the drive log refreshes itself when the driver comes back", () => {
  it("is actually rendered by the page", () => {
    expect(page).toMatch(/<MileageAutoRefresh\b/);
  });

  it("rides visibilitychange, the event a backgrounded WebView still delivers", () => {
    expect(autoRefresh).toMatch(
      /addEventListener\(\s*["']visibilitychange["']/,
    );
  });

  it("never polls, because a driver leaves this page open", () => {
    expect(
      /setInterval\s*\(/.test(autoRefresh),
      "a poll would run on every parked phone with the app open",
    ).toBe(false);
  });

  it("refetches the payload and never reloads the document", () => {
    // THE OUTAGE THIS PREVENTS. A reload re-runs the tracker's arm
    // sequence, whose first act is `await stopBgSafely(bg)`. A
    // backgrounded iOS WebView suspends at that await and never reaches
    // start(), so the background location service stays down until the
    // driver next opens the app by hand. Grace's iPhone logged 284
    // background heartbeats on 1.3.6 and one on 1.3.7. See PWASetup.
    expect(autoRefresh).toMatch(/router\.refresh\(\)/);
    expect(
      /location\.reload\s*\(/.test(autoRefresh),
      "a reload here tears down the live tracker",
    ).toBe(false);
  });

  it("gates the decision on the wall clock, via the tested pure function", () => {
    // Not on a timer having run. A backgrounded WebView freezes
    // setTimeout while native callbacks keep arriving; this repo has
    // measured timer_lag_ms in the hours.
    expect(autoRefresh).toMatch(/shouldRefreshOnReturn\s*\(/);
  });
});
