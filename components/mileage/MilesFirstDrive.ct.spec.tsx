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

/**
 * THE TAP FLOOR, OVER THE WHOLE SCREEN.
 *
 * MilesHead.ct.spec.tsx asserts the same two things, but it mounts the
 * HEAD alone. Everything below it went unmeasured, and at 390px the real
 * single-driver log carried twelve controls under 44px and twelve
 * `rounded-full`: Business, Personal and Review at 36px, Passenger at
 * 32px, delete at 32x32, and the team note's summary and link at 20px.
 * Those are the controls a driver taps all day, and a guard that cannot
 * see a whole half of the screen reads as coverage. This fixture already
 * mounts head, filter, rows and map, so it is the one that can see them.
 */
test("every control on the whole screen is at least 44px, and none is a pill", async ({
  mount,
  page,
}) => {
  await page.route("**/api/mileage/drives*", (r) =>
    r.fulfill({ json: { points: [] } }),
  );
  const c = await mount(<DriverPageHead />);
  // Open the row's delete confirmation, which is a pair of controls that
  // only exists after a tap and is therefore invisible to any guard that
  // measures the first paint alone.
  await c.getByRole("button", { name: "Delete trip" }).first().click();
  await expect(c.getByRole("button", { name: "Delete?" })).toBeVisible();

  const small = await c
    .locator("a, button, summary, [role=button]")
    .evaluateAll((els) =>
      els
        .map((el) => ({
          text: (el.textContent ?? "").trim().slice(0, 40),
          h: Math.round(el.getBoundingClientRect().height),
        }))
        // A control inside a closed <details> measures zero and is
        // nobody's tap target until the summary above it is tapped, and
        // that summary is measured here.
        .filter((m) => m.h > 0 && m.h < 44),
    );
  expect(small, `controls under 44px: ${JSON.stringify(small)}`).toEqual([]);
  expect(
    await c.locator(".rounded-full").count(),
    "the pill treatment this screen was rebuilt to remove is back",
  ).toBe(0);
  // Arrow glyphs, in LINK AND BUTTON text. The drive row puts one
  // between a start and an end time, which is a time range rather than a
  // control promising to take the reader somewhere.
  const arrows = await c
    .locator("a, button, summary, [role=button]")
    .evaluateAll((els) =>
      els
        .map((el) => (el.textContent ?? "").trim())
        .filter((t) => /[\u2190-\u21FF\u27A1]/u.test(t)),
    );
  expect(arrows, `an arrow glyph in a control: ${arrows.join(" | ")}`).toEqual(
    [],
  );
});
