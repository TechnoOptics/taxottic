import { test, expect } from "@playwright/experimental-ct-react";
import { ManagerPageHead } from "./MileageFirstPaint.ct.fixture";

// Galaxy Z Fold5 COVER screen: 904x2316 physical at 420dpi => ~344x882 CSS px.
// The layout defect this measures was reported from exactly this screen.
const FOLD_COVER = { width: 344, height: 882 };

// What the WebView actually gets to draw in. The 882 is the whole panel;
// Android keeps the status bar (24dp) and the three-button nav bar (48dp)
// for itself. An estimate, not a measurement from the device, and the
// assertions below are held to it rather than to the full panel so a
// pass here means "on screen", not "on screen if the OS gave up its bars".
const SYSTEM_BARS = 72;
const BUDGET = FOLD_COVER.height - SYSTEM_BARS;

test.use({ viewport: FOLD_COVER });

async function rects(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const box = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) throw new Error(`${sel} is not in the DOM`);
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    };
    return {
      h1: box("h1"),
      alert: box("section > :nth-child(4)"),
      controls: box("[data-ct=controls]"),
      firstPill: box("[data-ct=controls] > *"),
      map: box("[data-ct=map]"),
      vh: window.innerHeight,
      docWidth: document.documentElement.scrollWidth,
    };
  });
}

test.describe("Drive log first paint on the Fold cover screen", () => {
  test("a manager sees the controls and the map without scrolling", async ({ mount, page }) => {
    await mount(<ManagerPageHead />);
    await expect(page.locator("[data-ct=controls]")).toBeVisible();

    const m = await rects(page);
    console.log("FIRST PAINT metrics:", JSON.stringify(m));
    await page.screenshot({ path: "test-results/fold-mileage-first-paint.png", fullPage: true });

    expect(m.docWidth, "horizontal overflow").toBeLessThanOrEqual(FOLD_COVER.width);
    expect(
      m.controls.bottom,
      `the control row ends at ${m.controls.bottom}px, past the ${BUDGET}px the WebView can show`,
    ).toBeLessThanOrEqual(BUDGET);
    // Not merely "the map starts on screen": enough of it that a drive
    // drawn there is recognisable as one. 120px is a little under a
    // quarter of the map's height.
    expect(
      m.map.top + 120,
      `the map starts at ${m.map.top}px; the first drive is below the fold`,
    ).toBeLessThanOrEqual(BUDGET);
  });

  test("the alert and the note open to their full wording on tap", async ({ mount, page }) => {
    await mount(<ManagerPageHead />);

    const alertBody = page.getByText("Ask them to open Taxottic", { exact: false });
    await expect(alertBody).toBeHidden();
    await page.getByText("Some devices aren't tracking").click();
    await expect(alertBody).toBeVisible();
    await expect(page.getByText("Grace Hopper")).toBeVisible();
    await expect(page.getByText("Silent 42h")).toBeVisible();

    const noteBody = page.getByText("never their personal miles", { exact: false });
    await expect(noteBody).toBeHidden();
    // Visible without a tap: this is the manager's way back to their own log.
    await expect(page.getByRole("link", { name: /My drive log/ })).toBeVisible();
    await page.getByText("Team view", { exact: true }).click();
    await expect(noteBody).toBeVisible();
  });
});
