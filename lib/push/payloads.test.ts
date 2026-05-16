import { describe, it, expect } from "vitest";
import { buildPayload, type PushEvent } from "./payloads";

describe("buildPayload", () => {
  it("trip_classify is actionable + stable dedupe key", () => {
    const p = buildPayload({ kind: "trip_classify", tripId: "t1" });
    expect(p.category).toBe("TRIP_CLASSIFY");
    expect(p.data).toEqual({ kind: "trip_classify", tripId: "t1" });
    expect(p.dedupeKey).toBe("trip_classify:t1");
  });

  it("clarify wording switches on subject", () => {
    expect(
      buildPayload({ kind: "clarify", subject: "meal", refId: "e1" }).body,
    ).toMatch(/meal/i);
    expect(
      buildPayload({ kind: "clarify", subject: "trip", refId: "x" }).body,
    ).toMatch(/trip/i);
    const exp = buildPayload({
      kind: "clarify",
      subject: "expense",
      refId: "e2",
    });
    expect(exp.category).toBe("CLARIFY");
    expect(exp.dedupeKey).toBe("clarify:expense:e2");
  });

  it("non-interactive kinds carry no category", () => {
    for (const e of [
      { kind: "expense_applied", refId: "e1" },
      { kind: "goal_met", goalLabel: "Roth", goalId: "g1" },
      { kind: "badge_awarded", badgeLabel: "First filing", badgeCode: "b1" },
      {
        kind: "message",
        fromName: "Dana",
        threadId: "th1",
        messageId: "m1",
      },
    ] as PushEvent[]) {
      expect(buildPayload(e).category).toBeUndefined();
    }
  });

  it("dedupe keys are unique per logical event", () => {
    expect(
      buildPayload({ kind: "badge_awarded", badgeLabel: "X", badgeCode: "b" })
        .dedupeKey,
    ).toBe("badge_awarded:b");
    expect(
      buildPayload({
        kind: "message",
        fromName: "A",
        threadId: "t",
        messageId: "m",
      }).dedupeKey,
    ).toBe("message:t:m");
  });

  it("privacy: no $ amounts in any notification body", () => {
    const events: PushEvent[] = [
      { kind: "trip_classify", tripId: "t" },
      { kind: "clarify", subject: "meal", refId: "r" },
      { kind: "expense_applied", refId: "r" },
      { kind: "goal_met", goalLabel: "Q3 set-aside", goalId: "g" },
      { kind: "badge_awarded", badgeLabel: "Saver", badgeCode: "c" },
      { kind: "message", fromName: "Pat", threadId: "t", messageId: "m" },
    ];
    for (const e of events) {
      expect(buildPayload(e).body).not.toMatch(/\$|\d{2,}/);
    }
  });
});
