import { describe, it, expect } from "vitest";
import { bellaErrorMessage } from "./bella-errors";

describe("bellaErrorMessage", () => {
  it("never returns an empty string, whatever it is handed", () => {
    for (const input of [
      new Error("boom"),
      new Error(""),
      "a bare string",
      null,
      undefined,
      { nope: true },
    ]) {
      expect(bellaErrorMessage(input).length).toBeGreaterThan(0);
    }
  });

  it("explains a missing server credential without echoing the var name", () => {
    const msg = bellaErrorMessage(
      new Error("ANTHROPIC_API_KEY is not configured on the server."),
    );
    expect(msg).toMatch(/not set up|configured/i);
    expect(msg).not.toContain("ANTHROPIC_API_KEY");
    expect(msg).toMatch(/nothing was changed/i);
  });

  it("passes an insufficient-credits message through verbatim", () => {
    const raw =
      "Bella needs 10 credits to categorize this import; you have 3. Top up at /billing.";
    expect(bellaErrorMessage(new Error(raw))).toBe(raw);
  });

  it("keeps Bella's own already-user-facing copy intact", () => {
    const raw =
      "Bella didn't return valid JSON. The import is unchanged; try again.";
    expect(bellaErrorMessage(new Error(raw))).toBe(raw);
  });

  it("maps a rejected API credential to a support-facing message", () => {
    const msg = bellaErrorMessage(
      new Error("401 {\"error\":{\"type\":\"authentication_error\"}}"),
    );
    expect(msg).toMatch(/credential/i);
    expect(msg).toMatch(/nothing was changed/i);
  });

  it("maps rate limits and overload to a retry message", () => {
    for (const raw of [
      "429 rate_limit_error",
      "529 overloaded_error",
      "Request timed out.",
      "fetch failed",
    ]) {
      expect(bellaErrorMessage(new Error(raw))).toMatch(/try again/i);
    }
  });

  it("surfaces an unrecognized cause rather than swallowing it", () => {
    // The whole point of the fix: an unknown failure must still reach
    // the user as readable text, not as a redacted digest.
    const msg = bellaErrorMessage(new Error("column foo does not exist"));
    expect(msg).toContain("column foo does not exist");
  });

  it("truncates a very long cause instead of dumping it", () => {
    const msg = bellaErrorMessage(new Error("x".repeat(5000)));
    expect(msg.length).toBeLessThan(400);
  });
});
