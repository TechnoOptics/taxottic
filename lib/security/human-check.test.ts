import { describe, it, expect } from "vitest";
import {
  issueChallenge,
  verifySolve,
  verifyPass,
  type SolveMetrics,
} from "./human-check";

const NOW = 1_000_000_000_000;
const good: SolveMetrics = { elapsedMs: 1200, moves: 8, trusted: true };

describe("human-check", () => {
  it("issues a signed, unexpired challenge", () => {
    const ch = issueChallenge("nonce-1", NOW);
    expect(ch.nonce).toBe("nonce-1");
    expect(ch.exp).toBeGreaterThan(NOW);
    expect(ch.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a human solve and issues a verifiable pass", () => {
    const ch = issueChallenge("nonce-2", NOW);
    const r = verifySolve(ch, good, NOW + 1200);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(verifyPass(ch.nonce, r.value.pass, r.value.exp, NOW + 1200)).toBe(true);
      // A tampered nonce must not verify against the same pass.
      expect(verifyPass("other", r.value.pass, r.value.exp, NOW + 1200)).toBe(false);
    }
  });

  it("rejects a forged challenge signature", () => {
    const ch = { ...issueChallenge("nonce-3", NOW), sig: "0".repeat(64) };
    const r = verifySolve(ch, good, NOW + 1200);
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an expired challenge", () => {
    const ch = issueChallenge("nonce-4", NOW);
    const r = verifySolve(ch, good, ch.exp + 1);
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects an untrusted (synthetic) event", () => {
    const ch = issueChallenge("nonce-5", NOW);
    const r = verifySolve(ch, { ...good, trusted: false }, NOW + 1200);
    expect(r).toEqual({ ok: false, reason: "untrusted_event" });
  });

  it("rejects an instant (bot-fast) click", () => {
    const ch = issueChallenge("nonce-6", NOW);
    const r = verifySolve(ch, { ...good, elapsedMs: 50 }, NOW + 50);
    expect(r).toEqual({ ok: false, reason: "timing" });
  });

  it("rejects a solve with no pointer movement", () => {
    const ch = issueChallenge("nonce-7", NOW);
    const r = verifySolve(ch, { ...good, moves: 0 }, NOW + 1200);
    expect(r).toEqual({ ok: false, reason: "no_interaction" });
  });

  it("rejects a stale pass token", () => {
    const ch = issueChallenge("nonce-8", NOW);
    const r = verifySolve(ch, good, NOW + 1200);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(verifyPass(ch.nonce, r.value.pass, r.value.exp, r.value.exp + 1)).toBe(false);
    }
  });
});
