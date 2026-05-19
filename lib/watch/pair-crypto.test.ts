import { describe, it, expect } from "vitest";
import {
  sha256Hex,
  mintWatchToken,
  mintPairCode,
  hashPairCode,
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

  it("mintPairCode: 8 chars from the unambiguous alphabet, hash matches", () => {
    const { code, codeHash } = mintPairCode();
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(code).not.toMatch(/[0O1IL]/);
    expect(codeHash).toBe(hashPairCode(code));
    expect(hashPairCode(code)).toBe(sha256Hex(code));
  });

  it("safeHexEqual: true only for identical equal-length digests", () => {
    const a = sha256Hex("x");
    expect(safeHexEqual(a, a)).toBe(true);
    expect(safeHexEqual(a, sha256Hex("y"))).toBe(false);
    expect(safeHexEqual(a, a.slice(0, 10))).toBe(false); // length differs
  });
});
