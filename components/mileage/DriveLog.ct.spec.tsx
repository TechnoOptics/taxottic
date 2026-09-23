import { test, expect } from "@playwright/experimental-ct-react";
import { DriveLog } from "./DriveLog";

/**
 * The load-older call, at its CALL SITE.
 *
 * lib/mileage/drive-page.ts pages on a TUPLE cursor and its own unit
 * tests prove the tuple works. None of them can see what this component
 * actually puts in the query string, and a caller that sends `before`
 * alone is served happily: the server simply excludes every row tied
 * with the cursor, so whichever drive of a tied pair had not been shown
 * yet is skipped for good. No error, no empty state, just a drive that
 * is gone. That is this codebase's standing failure mode, so the cursor
 * is asserted here rather than trusted.
 */

const DAY = 86_400_000;
const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

function drive(id: string, daysAgo: number) {
  return {
    id,
    driver_user_id: "u-self",
    started_at: iso(daysAgo),
    ended_at: iso(daysAgo),
    distance_miles: 4.2,
    classification: "business" as const,
    tax_year: 2026,
    deduction_cents: 319,
    needs_confirmation: false,
    start_place_id: null,
    end_place_id: null,
    startPlace: null,
    endPlace: null,
  };
}

// Two drives that started in the same instant, which is ordinary at GPS
// precision, plus a newer one. drive-page.ts breaks a tie by id
// DESCENDING, so the oldest row of the set is the tied one with the
// SMALLEST id: "aaa".
const DRIVES = [drive("ccc", 1), drive("bbb", 2), drive("aaa", 2)];

const noop = async () => {};

test("asks for older drives with the whole tuple cursor, then stops at an empty page", async ({
  mount,
  page,
}) => {
  // The same endpoint serves one drive's polyline, which every row on
  // screen asks for on its own, so the list requests are the ones with no
  // `trip` in them. Routing them together and splitting here is what
  // keeps the row fetches from being counted as pages.
  const asked: string[] = [];
  await page.route("**/api/mileage/drives*", (r) => {
    const url = new URL(r.request().url());
    if (url.searchParams.has("trip")) return r.fulfill({ json: { points: [] } });
    asked.push(url.toString());
    return r.fulfill({ json: { drives: [] } });
  });
  await page.setViewportSize({ width: 390, height: 800 });
  const c = await mount(
    <div data-skin="instrument">
      <DriveLog
        initialDrives={DRIVES}
        initialExcluded={[]}
        companyId="co-1"
        driverParam=""
        places={[]}
        reclassify={noop}
        deleteTrip={noop}
        companies={[{ id: "co-1", name: "Acme" }]}
        moveTripCompany={noop}
      />
    </div>,
  );

  // A window that reaches back past everything loaded is what makes the
  // control admit it may be showing fewer drives than exist.
  await c.getByRole("button", { name: /92 days/i }).click();
  const older = c.getByRole("button", { name: /Load more/i });
  await expect(older).toBeVisible();
  await older.click();

  await expect.poll(() => asked.length).toBe(1);
  const url = new URL(asked[0]);
  expect(url.searchParams.get("company")).toBe("co-1");
  expect(url.searchParams.get("before")).toBe(iso(2));
  expect(
    url.searchParams.get("beforeId"),
    "the cursor lost its tie-break, so a drive tied with it is skipped for good",
  ).toBe("aaa");

  // An empty page is the end of the list. A SHORT page is not, which is
  // why the signal is emptiness: a cluster of drives sharing one instant
  // can return fewer rows than a page holds and still have more behind
  // it.
  await expect(older).toHaveCount(0);
});
