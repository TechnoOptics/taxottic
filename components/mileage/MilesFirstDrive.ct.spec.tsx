import { test, expect } from "@playwright/experimental-ct-react";
import { DriverPageHead } from "./MilesFirstDrive.ct.fixture";

/**
 * How far a driver scrolls to reach a drive, on the screen the complaint
 * came from.
 *
 * Measured against this exact fixture at 3c5f0b3, with the head the page
 * had then (breadcrumb, two-line title, company line, tracking alert,
 * driver picker, auto-track card, tracker strip, the "3 drives need a
 * quick call" card and eight pills):
 *
 *   window filter   769px
 *   map             889px
 *   first drive row 1405px
 *
 * The budgets below are held a little above what the collapsed head
 * measures, so an ordinary edit does not trip them and a returning head
 * does.
 */
const PHONE = { width: 390, height: 844 };

test.use({ viewport: PHONE });

test("the head is one screen-third, and the filter is above the fold", async ({
  mount,
  page,
}) => {
  await mount(<DriverPageHead />);
  const m = await page.evaluate(() => {
    const top = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) throw new Error(`${sel} is not in the DOM`);
      return Math.round(el.getBoundingClientRect().top + window.scrollY);
    };
    return {
      head: top("header"),
      filter: top("[role=group][aria-label='Filter drives']"),
      map: top("[data-ct=map]"),
      firstRow: top("li.card"),
      docWidth: document.documentElement.scrollWidth,
    };
  });
  console.log("SINGLE-DRIVER metrics:", JSON.stringify(m));
  await page.screenshot({
    path: "test-results/miles-single-driver-first-paint.png",
    fullPage: true,
  });

  expect(m.docWidth, "horizontal overflow").toBeLessThanOrEqual(PHONE.width);
  // 769px before. Everything above the filter is the head.
  expect(
    m.filter,
    `the window filter starts at ${m.filter}px; the head has grown back`,
  ).toBeLessThanOrEqual(330);
  // The map is what a driver sees first, so enough of it has to be on
  // screen to read as drives rather than as a grey band.
  expect(
    m.map + 200,
    `the map starts at ${m.map}px; the drives are below the fold`,
  ).toBeLessThanOrEqual(PHONE.height);
  // 1405px before. The map is 420px of this and belongs to the drives.
  expect(
    m.firstRow,
    `the first drive row starts at ${m.firstRow}px`,
  ).toBeLessThanOrEqual(1000);
});

test("the waiting count in the head lands on the first drive that wants one", async ({
  mount,
  page,
}) => {
  const c = await mount(<DriverPageHead />);
  const link = c.getByRole("link", { name: /waiting/ });
  await expect(link).toHaveAttribute("href", "#first-unclassified");
  // The anchor is on a real row, and on the unclassified one rather than
  // on whichever row happens to be first.
  const anchored = page.locator("#first-unclassified");
  await expect(anchored).toHaveCount(1);
  await expect(anchored).toContainText("22.7 mi");
});
