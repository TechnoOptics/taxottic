import { describe, it, expect } from "vitest";
import {
  sha256Hex,
  mintWatchToken,
  mintPairCode,
  hashPairCode,
  normalizePairCode,
  safeHexEqual,
} from "./pair-crypto";

describe("watch pair-crypto", () => {
  it("sha256Hex is deterministic 64-hex", () => {
    const h = sha256Hex("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("hello")).toBe(h);
    expect(sha256Hex("hellp")).not.toBe(h);
  });

  it("mintWatchToken: url-safe token whose hash matches", () => {
    const { token, tokenHash } = mintWatchToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    expect(token.length).toBeGreaterThanOrEqual(42);
    expect(tokenHash).toBe(sha256Hex(token));
    // Fresh entropy each call.
    expect(mintWatchToken().token).not.toBe(token);
  });

  it("mintPairCode: 6 digits, leading-zero preserved, hash matches", () => {
    const { code, codeHash } = mintPairCode();
    // Exactly six numeric characters.
    expect(code).toMatch(/^\d{6}$/);
    // codeHash is the SHA-256 of the plaintext code.
    expect(codeHash).toBe(hashPairCode(code));
    expect(hashPairCode(code)).toBe(sha256Hex(code));

    // Sanity-check that the zero-padding logic preserves the
    // leading-zero case (otherwise "012345" and "12345" would
    // collapse to the same row). Run a small batch and confirm
    // every result is six digits.
    for (let i = 0; i < 64; i++) {
      expect(mintPairCode().code).toMatch(/^\d{6}$/);
    }
  });

  it("normalizePairCode strips non-digits", () => {
    expect(normalizePairCode("012-345")).toBe("012345");
    expect(normalizePairCode("012 345")).toBe("012345");
    expect(normalizePairCode(" 0 1 2 3 4 5 ")).toBe("012345");
    expect(normalizePairCode("012abc345")).toBe("012345");
    expect(normalizePairCode("")).toBe("");
  });

  it("safeHexEqual: true only for identical equal-length digests", () => {
    const a = sha256Hex("x");
    expect(safeHexEqual(a, a)).toBe(true);
    expect(safeHexEqual(a, sha256Hex("y"))).toBe(false);
    expect(safeHexEqual(a, a.slice(0, 10))).toBe(false); // length differs
  });
});
