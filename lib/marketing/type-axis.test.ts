import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Year grammar sets headlines in Archivo on its width axis. Google
 * serves Archivo as a variable font with wdth 62..125; next/font only
 * downloads an axis it is told about, so `font-stretch: 112%` in CSS
 * does nothing unless layout.tsx declares `axes: ["wdth"]`. This pins
 * both halves so one cannot drift without the other.
 */
const ROOT = join(__dirname, "..", "..");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const layout = strip(readFileSync(join(ROOT, "app/layout.tsx"), "utf8"));
const css = strip(readFileSync(join(ROOT, "app/globals.css"), "utf8"));

describe("Archivo is loaded with its width axis", () => {
  it("layout.tsx declares axes: [\"wdth\"] on the Archivo font", () => {
    const m = /const archivo = Archivo\(\{([\s\S]*?)\}\);/.exec(layout);
    expect(m, "Archivo font block not found").toBeTruthy();
    expect(m![1]).toMatch(/axes:\s*\["wdth"\]/);
    expect(m![1], "a fixed weight list disables the variable axes").not.toMatch(/weight:\s*\[/);
  });

  it("the Instrument display rule sets the width, weight and tracking", () => {
    const m = /\[data-skin="instrument"\] \.display \{([\s\S]*?)\}/.exec(css);
    expect(m, "no [data-skin=\"instrument\"] .display rule").toBeTruthy();
    expect(m![1]).toMatch(/font-stretch:\s*112%/);
    expect(m![1]).toMatch(/font-weight:\s*600/);
    expect(m![1]).toMatch(/letter-spacing:\s*-0\.025em/);
    expect(m![1]).toMatch(/line-height:\s*1\.02/);
    expect(m![1]).toMatch(/lining-nums/);
  });

  it("defines .lede and .mono-label once", () => {
    // Anchored to line start (no leading whitespace) so the indented
    // `@media (min-width: 640px)` override of .lede, which repeats the
    // same selector text on purpose, does not count as a second
    // definition of the base rule.
    expect((css.match(/^\[data-skin="instrument"\] \.lede \{/gm) ?? []).length).toBe(1);
    expect((css.match(/^\[data-skin="instrument"\] \.mono-label \{/gm) ?? []).length).toBe(1);
  });
});
