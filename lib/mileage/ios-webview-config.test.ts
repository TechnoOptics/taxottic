import { readFileSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Source-level guard: the iOS web view has to opt in to the edge swipe.
 *
 * WKWebView defaults allowsBackForwardNavigationGestures to false, so a
 * swipe from the left edge does nothing and the app reads as a dead end
 * on the one gesture every iOS user tries first. There is no runtime to
 * assert against from Node, so the source is the only place to catch a
 * regression before a build is cut.
 */
describe("the iOS web view allows the edge swipe", () => {
  it("sets allowsBackForwardNavigationGestures", () => {
    const dir = "ios/App/App";
    const swift = readdirSync(dir)
      .filter((f) => f.endsWith(".swift"))
      .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
      .join("\n");
    expect(
      swift,
      "an edge swipe does nothing on iOS without this",
    ).toMatch(/allowsBackForwardNavigationGestures\s*=\s*true/);
  });
});
