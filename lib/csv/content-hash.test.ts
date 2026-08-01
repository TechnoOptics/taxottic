import { describe, it, expect } from "vitest";
import { normalizeForHash, csvContentHash } from "./content-hash";

/**
 * The point of this module is one question: "is this the same document I
 * already imported, even though it has a different filename?" Byte equality
 * answers that too conservatively: banks re-export the same statement with
 * different line endings, a BOM, or a trailing newline, and a byte hash calls
 * those different files. So we hash normalized content.
 */

describe("normalizeForHash", () => {
  it("strips a UTF-8 BOM", () => {
    expect(normalizeForHash("﻿Date,Amount")).toBe("Date,Amount");
  });

  it("treats CRLF and LF as the same document", () => {
    expect(normalizeForHash("a,b\r\nc,d")).toBe(normalizeForHash("a,b\nc,d"));
  });

  it("treats a lone CR (classic Mac export) as the same document", () => {
    expect(normalizeForHash("a,b\rc,d")).toBe(normalizeForHash("a,b\nc,d"));
  });

  it("ignores trailing whitespace on a line", () => {
    expect(normalizeForHash("a,b   \nc,d")).toBe(normalizeForHash("a,b\nc,d"));
  });

  it("ignores trailing blank lines", () => {
    expect(normalizeForHash("a,b\nc,d\n\n\n")).toBe(normalizeForHash("a,b\nc,d"));
  });

  it("does NOT ignore a real content difference", () => {
    expect(normalizeForHash("a,b\nc,d")).not.toBe(normalizeForHash("a,b\nc,e"));
  });

  it("does NOT lowercase, because case is content", () => {
    expect(normalizeForHash("Costco")).not.toBe(normalizeForHash("costco"));
  });

  it("does not collapse an interior blank line, which shifts rows", () => {
    expect(normalizeForHash("a\n\nb")).not.toBe(normalizeForHash("a\nb"));
  });
});

describe("csvContentHash", () => {
  it("is a 64-char lowercase hex sha-256", async () => {
    const h = await csvContentHash("Date,Amount\n2026-01-02,-12.34");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches for the same statement saved under two filenames", async () => {
    // Identical content; the filename never enters the hash.
    const body = "Date,Description,Amount\n2026-01-02,COSTCO,-12.34\n";
    const a = await csvContentHash(body);
    const b = await csvContentHash("﻿" + body.replace(/\n/g, "\r\n"));
    expect(a).toBe(b);
  });

  it("differs when a single cent differs", async () => {
    const a = await csvContentHash("Date,Amount\n2026-01-02,-12.34");
    const b = await csvContentHash("Date,Amount\n2026-01-02,-12.35");
    expect(a).not.toBe(b);
  });

  it("is stable across calls", async () => {
    const a = await csvContentHash("x,y\n1,2");
    const b = await csvContentHash("x,y\n1,2");
    expect(a).toBe(b);
  });
});
