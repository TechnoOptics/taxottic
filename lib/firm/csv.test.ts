import { describe, it, expect } from "vitest";
import { parseCsv, validateInviteRow } from "./csv";

describe("parseCsv", () => {
  it("returns empty result for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
    expect(parseCsv("   \n  ")).toEqual({ headers: [], rows: [] });
  });

  it("parses a simple header + one row", () => {
    const r = parseCsv("email,name\nriley@maple.com,Riley");
    expect(r.headers).toEqual(["email", "name"]);
    expect(r.rows).toEqual([{ email: "riley@maple.com", name: "Riley" }]);
  });

  it("normalizes header names to snake_case", () => {
    const r = parseCsv("Email Address,Full Name\nriley@m.com,Riley Chen");
    expect(r.headers).toEqual(["email_address", "full_name"]);
    expect(r.rows[0].email_address).toBe("riley@m.com");
    expect(r.rows[0].full_name).toBe("Riley Chen");
  });

  it("handles quoted commas", () => {
    const r = parseCsv(
      'email,business_name\nriley@m.com,"Smith, Allen & Co."',
    );
    expect(r.rows[0].business_name).toBe("Smith, Allen & Co.");
  });

  it("handles escaped quotes inside a field", () => {
    const r = parseCsv('email,name\nx@y.com,"She said ""hi"" today"');
    expect(r.rows[0].name).toBe('She said "hi" today');
  });

  it("handles CRLF line endings", () => {
    const r = parseCsv("email,name\r\nriley@m.com,Riley\r\nx@y.com,X");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[1].email).toBe("x@y.com");
  });

  it("strips a leading BOM", () => {
    const r = parseCsv("﻿email\nriley@m.com");
    expect(r.headers).toEqual(["email"]);
    expect(r.rows[0].email).toBe("riley@m.com");
  });

  it("drops empty trailing rows from copy-paste", () => {
    const r = parseCsv("email,name\nriley@m.com,Riley\n\n\n");
    expect(r.rows).toHaveLength(1);
  });

  it("tolerates missing trailing columns", () => {
    const r = parseCsv("email,name,kind\nriley@m.com,Riley");
    expect(r.rows[0]).toEqual({ email: "riley@m.com", name: "Riley", kind: "" });
  });
});

describe("validateInviteRow", () => {
  const defaults = { kind: "tax_prep", taxYear: 2026 };

  it("requires email", () => {
    const r = validateInviteRow({}, 2, defaults);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toMatch(/email/i);
  });

  it("rejects malformed email", () => {
    const r = validateInviteRow({ email: "not-an-email" }, 2, defaults);
    expect(r.ok).toBe(false);
  });

  it("accepts a minimal valid row + applies defaults", () => {
    const r = validateInviteRow({ email: "riley@m.com" }, 2, defaults);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.email).toBe("riley@m.com");
      expect(r.row.kind).toBe("tax_prep");
      expect(r.row.tax_year).toBe(2026);
      expect(r.row.full_name).toBeNull();
    }
  });

  it("honors per-row kind override", () => {
    const r = validateInviteRow(
      { email: "x@y.com", kind: "bookkeeping" },
      2,
      defaults,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.kind).toBe("bookkeeping");
  });

  it("falls back to default kind on invalid value", () => {
    const r = validateInviteRow(
      { email: "x@y.com", kind: "not_a_real_kind" },
      2,
      defaults,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.kind).toBe("tax_prep");
  });

  it("accepts `name` and `company` as fallback header aliases", () => {
    const r = validateInviteRow(
      { email: "x@y.com", name: "Riley", company: "Maple Lane" },
      2,
      defaults,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.full_name).toBe("Riley");
      expect(r.row.business_name).toBe("Maple Lane");
    }
  });
});
