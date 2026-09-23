import { test, expect } from "@playwright/experimental-ct-react";
import { DriverPageHead } from "./MilesFirstDrive.ct.fixture";

/**
 * How far a driver scrolls to reach a drive, on the screen the complaint
 * came from.
 *
 * Measured against the page as it stood at 3c5f0b3, with the head it had
 * then (breadcrumb, two-line title, company line, tracking alert, driver
 * picker, auto-track card, tracker strip, the "3 drives need a quick
 * call" card and eight pills) and the map still above the list:
 *
 *   window filter   769px
 *   map             889px
 *   first drive row 1405px
 *
 * The budgets below are held a little above what the collapsed head and
 * the demoted map measure, so an ordinary edit does not trip them and a
 * returning head does.
 */
const PHONE = { width: 390, height: 844 };

test.use({ viewport: PHONE });

test("the head is one screen-third, and a drive is on the first screen", async ({
  mount,
  page,
}) => {
  // `{ points: [] }` is the route's contract (loadRoutes in
  // MileageMap.tsx): a body with any other key is NO ANSWER, and this
  // stub used to say `routes`, so it quietly measured the layout of the
  // batch's give-up path instead of its ordinary one.
  await page.route("**/api/mileage/drives*", (r) =>
    r.fulfill({ json: { points: [] } }),
  );
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
      firstRow: top("li.card"),
      map: top("[aria-label='All drives in range']"),
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
  // 1405px before, and on the first screen now.
  expect(
    m.firstRow,
    `the first drive row starts at ${m.firstRow}px`,
  ).toBeLessThanOrEqual(PHONE.height - 120);
  // The map is below the drives, where spec 4.2 puts everything that is
  // not a drive. 420px of it used to sit between the filter and the row.
  expect(
    m.map,
    `the map is back above the drives, at ${m.map}px`,
  ).toBeGreaterThan(m.firstRow);
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
