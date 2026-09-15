import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { backAction } from "./back-action";

describe("system Back", () => {
  it("goes back when the WebView can, and exits when it cannot", () => {
    expect(backAction(true)).toBe("back");
    expect(backAction(false)).toBe("exit");
  });
  it("is wired: the listener trusts canGoBack and never reads history.length", () => {
    const src = readFileSync("components/EdgeSwipeBack.tsx", "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const listener = src.slice(src.indexOf('"backButton"'));
    expect(listener).toMatch(/backAction\(canGoBack\)/);
    expect(listener).not.toMatch(/history\.length/);
  });
});
