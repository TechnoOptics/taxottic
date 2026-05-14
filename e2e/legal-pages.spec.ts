import { test, expect } from "@playwright/test";

// Flow 4: every legal page renders without 404 / 500. Audit-time
// requirement: privacy + ToS + DPA + accessibility + cookies + security +
// subprocessors + DMCA + acceptable use all need to be one-click
// reachable so a CPA evaluating Taxottic can verify our posture.

const LEGAL_PAGES = [
  "/legal",
  "/legal/privacy",
  "/legal/terms",
  "/legal/security",
  "/legal/dpa",
  "/legal/cookies",
  "/legal/accessibility",
  "/legal/subprocessors",
  "/legal/dmca",
  "/legal/acceptable-use",
];

for (const path of LEGAL_PAGES) {
  test(`${path} renders successfully`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.ok()).toBeTruthy();
    // Every legal page must have an <h1>.
    await expect(page.locator("h1").first()).toBeVisible();
  });
}
