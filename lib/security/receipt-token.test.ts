import { describe, it, expect } from "vitest";
import { issueReceiptToken, verifyReceiptToken } from "./receipt-token";

const NOW = 1_000_000_000_000;

describe("receipt-token", () => {
  it("verifies a genuine token for the same user", () => {
    const { token, exp } = issueReceiptToken("user-1", NOW);
    expect(verifyReceiptToken("user-1", token, exp, NOW)).toBe(true);
  });

  it("rejects the token for a different user (no cross-user reuse)", () => {
    const { token, exp } = issueReceiptToken("user-1", NOW);
    expect(verifyReceiptToken("user-2", token, exp, NOW)).toBe(false);
  });

  it("rejects an expired token", () => {
    const { token, exp } = issueReceiptToken("user-1", NOW);
    expect(verifyReceiptToken("user-1", token, exp, exp + 1)).toBe(false);
  });

  it("rejects a forged/empty token", () => {
    const { exp } = issueReceiptToken("user-1", NOW);
    expect(verifyReceiptToken("user-1", "", exp, NOW)).toBe(false);
    expect(verifyReceiptToken("user-1", "0".repeat(64), exp, NOW)).toBe(false);
  });

  it("rejects a tampered expiry", () => {
    const { token, exp } = issueReceiptToken("user-1", NOW);
    expect(verifyReceiptToken("user-1", token, exp + 1000, NOW)).toBe(false);
  });
});
