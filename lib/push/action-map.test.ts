import { describe, it, expect } from "vitest";
import { resolvePushAction } from "./action-map";

describe("resolvePushAction", () => {
  it("trip_classify + Business/Personal → reclassify that trip", () => {
    expect(
      resolvePushAction(
        { kind: "trip_classify", tripId: "t1" },
        "business",
      ),
    ).toEqual({
      type: "reclassify_trip",
      tripId: "t1",
      classification: "business",
    });
    expect(
      resolvePushAction(
        { kind: "trip_classify", tripId: "t1" },
        "PERSONAL",
      ),
    ).toEqual({
      type: "reclassify_trip",
      tripId: "t1",
      classification: "personal",
    });
  });

  it("clarify(subject=trip) maps via refId", () => {
    expect(
      resolvePushAction(
        { kind: "clarify", subject: "trip", refId: "t9" },
        "business",
      ),
    ).toEqual({
      type: "reclassify_trip",
      tripId: "t9",
      classification: "business",
    });
  });

  it("clarify(meal/expense) never mutates from a tap → open", () => {
    expect(
      resolvePushAction(
        { kind: "clarify", subject: "meal", refId: "e1" },
        "business",
      ),
    ).toEqual({ type: "open" });
    expect(
      resolvePushAction(
        { kind: "clarify", subject: "expense", refId: "e2" },
        "personal",
      ),
    ).toEqual({ type: "open" });
  });

  it("the default tap / unknown action / missing id → open", () => {
    expect(
      resolvePushAction({ kind: "trip_classify", tripId: "t1" }, "tap"),
    ).toEqual({ type: "open" });
    expect(
      resolvePushAction({ kind: "expense_applied", refId: "e1" }, "business"),
    ).toEqual({ type: "open" });
    expect(
      resolvePushAction({ kind: "trip_classify" }, "business"),
    ).toEqual({ type: "open" });
    expect(resolvePushAction(null, null)).toEqual({ type: "open" });
  });
});
