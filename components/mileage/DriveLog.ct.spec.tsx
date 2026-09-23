import {
  test,
  expect,
  type ComponentFixtures,
  type MountResult,
} from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
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

async function mountLog(
  mount: ComponentFixtures["mount"],
  page: Page,
): Promise<MountResult> {
  await page.setViewportSize({ width: 390, height: 800 });
  return mount(
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
}

test("asks for older drives with the whole tuple cursor", async ({
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
  const c = await mountLog(mount, page);

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

  // One empty page is NOT the end. See the next test.
  await expect(older).toBeVisible();
});

/**
 * A blip must not switch "load more" off for the session.
 *
 * `{ drives: [] }` with a 200 is not always an answer: loadScopedTrips
 * swallows a Supabase error into `data ?? []` and the route answers with
 * an empty list when a membership does not resolve. Latching the end of
 * the log on the first one left the reader no way back short of
 * reloading the page, with nothing on screen to say what happened.
 */
test("one empty page leaves the control usable, two end the list", async ({
  mount,
  page,
}) => {
  let pages = 0;
  await page.route("**/api/mileage/drives*", (r) => {
    const url = new URL(r.request().url());
    if (url.searchParams.has("trip")) return r.fulfill({ json: { points: [] } });
    pages += 1;
    return r.fulfill({ json: { drives: [] } });
  });
  const c = await mountLog(mount, page);
  await c.getByRole("button", { name: /92 days/i }).click();
  const older = c.getByRole("button", { name: /Load more/i });

  await older.click();
  await expect.poll(() => pages).toBe(1);
  await expect(
    older,
    "one empty page ended the list, so a single blip is unrecoverable",
  ).toBeVisible();

  await older.click();
  await expect.poll(() => pages).toBe(2);
  await expect(older).toHaveCount(0);
});

test("a failed load says so and stays tappable", async ({ mount, page }) => {
  let fail = true;
  const sent: string[] = [];
  await page.route("**/api/mileage/drives*", (r) => {
    const url = new URL(r.request().url());
    if (url.searchParams.has("trip")) return r.fulfill({ json: { points: [] } });
    sent.push(url.toString());
    if (fail) return r.fulfill({ status: 500, json: { error: "nope" } });
    return r.fulfill({ json: { drives: [drive("zzz", 5)] } });
  });
  const c = await mountLog(mount, page);
  await c.getByRole("button", { name: /92 days/i }).click();
  const older = c.getByRole("button", { name: /Load more/i });

  await older.click();
  await expect.poll(() => sent.length).toBe(1);
  // A tap that fails silently is indistinguishable from the dead control
  // this whole change removed.
  await expect(c.getByRole("status")).toContainText("Could not load older");
  await expect(older).toBeVisible();

  // And the failure did not count towards the end of the list: the retry
  // is allowed, and it works.
  fail = false;
  await older.click();
  await expect.poll(() => sent.length).toBe(2);
  await expect(c.getByRole("status")).toHaveCount(0);
});
