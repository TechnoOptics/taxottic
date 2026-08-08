import { describe, expect, it } from "vitest";
import {
  shouldAdoptWaitingWorker,
  shouldReloadOnControllerChange,
} from "./adopt-policy";

const base = {
  visibility: "visible" as DocumentVisibilityState,
  alreadyAdopted: false,
  hasWaitingWorker: true,
};

describe("shouldAdoptWaitingWorker", () => {
  it("adopts a waiting worker while the page is visible", () => {
    expect(shouldAdoptWaitingWorker(base)).toBe(true);
  });

  // THE REGRESSION TEST. Deleting the visibility clause from the policy makes
  // this fail. 1.3.7 shipped without it and cost a real device four days of
  // background tracking, because adopting reloads the page and a reload in a
  // backgrounded WebView disarms the location watcher without re-arming it.
  it("refuses to adopt while the page is hidden", () => {
    expect(shouldAdoptWaitingWorker({ ...base, visibility: "hidden" })).toBe(
      false,
    );
  });

  it("still refuses while hidden even on a cold start with a worker left waiting", () => {
    // Cold start is the other caller: a worker left waiting by a previous
    // session. A page that boots hidden (iOS relaunching the shell in the
    // background) must not seize it either.
    expect(
      shouldAdoptWaitingWorker({
        visibility: "hidden",
        alreadyAdopted: false,
        hasWaitingWorker: true,
      }),
    ).toBe(false);
  });

  it("adopts at most once per page life", () => {
    expect(shouldAdoptWaitingWorker({ ...base, alreadyAdopted: true })).toBe(
      false,
    );
  });

  it("does nothing when there is no waiting worker", () => {
    expect(shouldAdoptWaitingWorker({ ...base, hasWaitingWorker: false })).toBe(
      false,
    );
  });
});

describe("shouldReloadOnControllerChange", () => {
  it("reloads while the page is visible", () => {
    expect(
      shouldReloadOnControllerChange({
        visibility: "visible",
        alreadyReloading: false,
      }),
    ).toBe(true);
  });

  // THE REGRESSION TEST FOR THE ACTUAL OUTAGE.
  //
  // sw.js self-skipWaiting()s on install and clients.claim()s on activate, so
  // controllerchange fires in hidden clients with no involvement from the
  // page's adopt path. An unconditional reload here reloads a backgrounded
  // WebView, whose fresh page life calls `await stopBgSafely(bg)` and is then
  // suspended by iOS before bg.start() re-arms. Background location stays
  // down until the app is opened by hand.
  //
  // The first fix for this gated adoption only and left this path wide open,
  // and a full green test suite said nothing. Delete the visibility clause in
  // shouldReloadOnControllerChange and this fails.
  it("refuses to reload while the page is hidden", () => {
    expect(
      shouldReloadOnControllerChange({
        visibility: "hidden",
        alreadyReloading: false,
      }),
    ).toBe(false);
  });

  it("never reloads twice in one page life", () => {
    expect(
      shouldReloadOnControllerChange({
        visibility: "visible",
        alreadyReloading: true,
      }),
    ).toBe(false);
  });

  it("fails closed on an unfamiliar visibility state", () => {
    // Fail closed means "do not reload": a page that might be holding a GPS
    // watcher is not torn down on a state we do not recognise.
    const exotic = "prerender" as DocumentVisibilityState;
    expect(
      shouldReloadOnControllerChange({
        visibility: exotic,
        alreadyReloading: false,
      }),
    ).toBe(false);
  });

  it("does not by itself prevent a background reload", () => {
    // Documenting a REAL limitation rather than implying coverage this
    // function does not provide. sw.js calls self.skipWaiting() in its own
    // install handler and clients.claim() on activate, so a new worker takes
    // control without the page ever adopting. The protection that matters on
    // that path is shouldReloadOnControllerChange below. Shipping only the
    // adopt gate left the outage live.
    expect(shouldAdoptWaitingWorker({ ...base, visibility: "hidden" })).toBe(
      false,
    );
  });

  it("treats every non-visible state as unsafe, not just 'hidden'", () => {
    // DocumentVisibilityState is a union today, but browsers have shipped
    // others ("prerender"). The policy is an allowlist on "visible" rather
    // than a denylist on "hidden" so a new state fails closed.
    const exotic = "prerender" as DocumentVisibilityState;
    expect(shouldAdoptWaitingWorker({ ...base, visibility: exotic })).toBe(
      false,
    );
  });
});
