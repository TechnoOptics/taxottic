import { describe, it, expect } from "vitest";
import {
  RETURN_REFRESH_MIN_STALE_MS,
  shouldRefreshOnReturn,
} from "./return-refresh";

const T0 = 1_700_000_000_000;

describe("shouldRefreshOnReturn", () => {
  it("refreshes when the driver comes back to a page that has gone stale", () => {
    expect(
      shouldRefreshOnReturn({
        visibility: "visible",
        nowMs: T0 + RETURN_REFRESH_MIN_STALE_MS,
        lastRefreshedAtMs: T0,
      }),
    ).toBe(true);
  });

  it("refuses while the page is hidden, however old it is", () => {
    // The whole feature exists for a backgrounded WebView. fetch() is
    // throttled there and nobody is looking at the result, so a refresh
    // issued while hidden buys a stalled request and nothing else. The
    // visibilitychange that brings the app forward is the trigger.
    expect(
      shouldRefreshOnReturn({
        visibility: "hidden",
        nowMs: T0 + 6 * 60 * 60_000,
        lastRefreshedAtMs: T0,
      }),
    ).toBe(false);
  });

  it("refuses a quick tab-out and back, which must not cost a render", () => {
    expect(
      shouldRefreshOnReturn({
        visibility: "visible",
        nowMs: T0 + 5_000,
        lastRefreshedAtMs: T0,
      }),
    ).toBe(false);
  });

  it("refuses when the device clock has moved backwards", () => {
    // Staleness is unknowable across a backward jump, and this codebase
    // already carries clock-skew handling for phones that do it. Refusing
    // costs one missed auto-refresh; trusting a negative age would fire
    // on every event until the clock caught up.
    expect(
      shouldRefreshOnReturn({
        visibility: "visible",
        nowMs: T0 - 60_000,
        lastRefreshedAtMs: T0,
      }),
    ).toBe(false);
  });

  it("refuses before the page has been stamped as rendered", () => {
    // The caller stamps in an effect, so the very first events of a
    // mount can arrive with nothing recorded yet. An unstamped page is
    // not a stale one, and treating null as epoch zero would make every
    // fresh mount fire a redundant render.
    expect(
      shouldRefreshOnReturn({
        visibility: "visible",
        nowMs: T0,
        lastRefreshedAtMs: null,
      }),
    ).toBe(false);
  });

  it("treats a non-finite stamp as not stale rather than refreshing forever", () => {
    expect(
      shouldRefreshOnReturn({
        visibility: "visible",
        nowMs: T0,
        lastRefreshedAtMs: Number.NaN,
      }),
    ).toBe(false);
  });

  it("waits long enough that a page-to-page tap is never doubled", () => {
    // Load-bearing: the driver taps a range pill, which is a navigation
    // and its own render. If the window were a second or two, the focus
    // that follows that tap would fire a second render on top of it.
    expect(RETURN_REFRESH_MIN_STALE_MS).toBeGreaterThanOrEqual(30_000);
  });
});
