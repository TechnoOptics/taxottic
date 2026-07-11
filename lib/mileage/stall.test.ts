import { describe, it, expect } from "vitest";
import {
  evaluateTrackerStall,
  STALL_AFTER_MS,
  RENOTIFY_MS,
  WATCH_WINDOW_MS,
} from "./stall";

const H = 60 * 60_000;
const NOW = 1_800_000_000_000; // fixed epoch for determinism

describe("evaluateTrackerStall", () => {
  it("uploading recently → clear (ends any open episode)", () => {
    expect(
      evaluateTrackerStall({
        lastUploadMs: NOW - 10 * 60_000, // 10 min ago
        nowMs: NOW,
        lastNotifiedMs: NOW - 5 * H, // stale episode state present
      }),
    ).toBe("clear");
  });

  it("Grace's case: silent for hours, never notified → notify", () => {
    expect(
      evaluateTrackerStall({
        lastUploadMs: NOW - 17 * H,
        nowMs: NOW,
        lastNotifiedMs: null,
      }),
    ).toBe("notify");
  });

  it("just under the 3h threshold → clear, at/over → notify", () => {
    expect(
      evaluateTrackerStall({
        lastUploadMs: NOW - (STALL_AFTER_MS - 1),
        nowMs: NOW,
        lastNotifiedMs: null,
      }),
    ).toBe("clear");
    expect(
      evaluateTrackerStall({
        lastUploadMs: NOW - STALL_AFTER_MS,
        nowMs: NOW,
        lastNotifiedMs: null,
      }),
    ).toBe("notify");
  });

  it("already notified this episode → silent until the 24h re-notify", () => {
    expect(
      evaluateTrackerStall({
        lastUploadMs: NOW - 6 * H,
        nowMs: NOW,
        lastNotifiedMs: NOW - 2 * H,
      }),
    ).toBe("silent");
    expect(
      evaluateTrackerStall({
        lastUploadMs: NOW - 30 * H,
        nowMs: NOW,
        lastNotifiedMs: NOW - RENOTIFY_MS,
      }),
    ).toBe("notify");
  });

  it("dead beyond the 7-day watch window → silent (stop nagging)", () => {
    expect(
      evaluateTrackerStall({
        lastUploadMs: NOW - (WATCH_WINDOW_MS + H),
        nowMs: NOW,
        lastNotifiedMs: null,
      }),
    ).toBe("silent");
  });
});
