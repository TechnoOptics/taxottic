import { describe, expect, it } from "vitest";
import { shouldAdoptWaitingWorker } from "./adopt-policy";

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
