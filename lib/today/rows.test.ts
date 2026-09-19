import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("the app renders the same rows the marketing screens do", () => {
  it("re-exports the primitives from one place", () => {
    const src = readFileSync("components/ui/Rows.ts", "utf8");
    expect(src).toMatch(/export \{ Screen, StatRow, LedgerRow, CategoryBar, MiniMap \} from "@\/components\/marketing\/Screen";/);
  });
});
