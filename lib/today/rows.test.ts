import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("the app renders the same rows the marketing screens do", () => {
  it("re-exports the primitives from one place", () => {
    const src = readFileSync("components/ui/Rows.ts", "utf8");
    // Whitespace- and order-tolerant: the intent is that all five row
    // primitives reach the app from components/marketing/Screen and from
    // nowhere else, not that the export list is formatted on one line.
    const reExport = /export\s*\{([^}]*)\}\s*from\s*"@\/components\/marketing\/Screen"\s*;/.exec(src);
    expect(reExport, "components/ui/Rows.ts must re-export from components/marketing/Screen").toBeTruthy();
    const named = reExport![1].split(",").map((n) => n.trim()).filter(Boolean).sort();
    expect(named).toEqual(["CategoryBar", "LedgerRow", "MiniMap", "Screen", "StatRow"]);
  });
});
