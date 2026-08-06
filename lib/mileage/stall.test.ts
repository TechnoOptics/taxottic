import { describe, it, expect } from "vitest";
import {
  evaluateTrackerStall,
  nextEscalatedAt,
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

describe("nextEscalatedAt", () => {
  const T1 = "2026-08-06T19:29:56.000Z";
  const T2 = "2026-08-06T20:31:01.000Z";

  it("keeps an earlier escalation when this tick escalated nobody", () => {
    // The regression: the manager notify is deduped per driver per day,
    // so every tick after the first reports delivered:0 and passes null
    // here. Writing that null erased a real escalation.
    expect(nextEscalatedAt(T1, null)).toBe(T1);
  });

  it("takes a fresh escalation over the stored one", () => {
    expect(nextEscalatedAt(T1, T2)).toBe(T2);
  });

  it("records the first escalation of an episode", () => {
    expect(nextEscalatedAt(null, T1)).toBe(T1);
  });

  it("stays null while nobody has been escalated to", () => {
    expect(nextEscalatedAt(null, null)).toBeNull();
  });

  it("treats a missing column as no escalation, not a crash", () => {
    // alert?.escalated_at is undefined when the row or select omits it.
    expect(nextEscalatedAt(undefined, null)).toBeNull();
    expect(nextEscalatedAt(undefined, T1)).toBe(T1);
  });
});
