import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { barOf, statusBarPlan } from "./status-bar";

describe("status bar follows the page", () => {
  it("paper pages get dark glyphs on the page ground; navy pages get light glyphs on navy", () => {
    expect(statusBarPlan("paper", "light")).toEqual({ style: "Light", color: "#f2f5f8" });
    expect(statusBarPlan("paper", "dark")).toEqual({ style: "Dark", color: "#0c1017" });
    expect(statusBarPlan("navy", "light")).toEqual({ style: "Dark", color: "#121a2a" });
    expect(statusBarPlan("navy", "dark")).toEqual({ style: "Dark", color: "#121a2a" });
  });
  it("reads the attribute the app header sets and defaults to paper", () => {
    expect(barOf({ dataset: { bar: "navy" } })).toBe("navy");
    expect(barOf({ dataset: {} })).toBe("paper");
  });
  it("is wired: one band element, no body::before band, the header sets the attribute, the init reapplies", () => {
    // Comments are stripped first so a `body::before` mentioned in prose
    // can't be counted as a rule.
    const css = readFileSync("app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(
      css.match(/^body::before\s*\{/gm)?.length ?? 0,
      "no body::before rule remains; the band is #status-bar-band",
    ).toBe(0);
    expect(css).toMatch(/#status-bar-band\s*\{/);
    expect(css).toMatch(/html\[data-bar="navy"\]\s*\{\s*--status-band:\s*#121a2a/);
    expect(readFileSync("app/layout.tsx", "utf8")).toMatch(/<StatusBarBand \/>/);
    expect(readFileSync("components/AppHeader.tsx", "utf8")).toMatch(/<NavyBar \/>/);
    const navy = readFileSync("components/NavyBar.tsx", "utf8");
    expect(navy).toMatch(/dataset\.bar = "navy"/);
    expect(navy).toMatch(/delete document\.documentElement\.dataset\.bar/);
    const init = readFileSync("components/CapacitorNativeInit.tsx", "utf8");
    expect(init).toMatch(/statusBarPlan\(/);
    expect(init).toMatch(/addEventListener\("resize", applyStatusBar/);
    expect(init).toMatch(/new MutationObserver\(applyStatusBar\)/);
    // The init runs inside an effect that can be torn down and re-run
    // (Strict Mode, a remount). A resize listener left behind holds the
    // whole closure and fires against a dead StatusBar handle.
    expect(
      init,
      "the resize listener is removed on teardown",
    ).toMatch(
      /teardown\.push\(\(\) =>\s*window\.removeEventListener\("resize", applyStatusBar\)/,
    );
  });
});
