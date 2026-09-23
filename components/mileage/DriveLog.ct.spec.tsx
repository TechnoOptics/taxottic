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

/**
 * The self view's map, which is the one almost everybody sees.
 *
 * Task 2 deleted the page's blocking polyline fetch; this component then
 * handed `points: []` to the map underneath it, so the drive log drew no
 * routes at all. The team-overlay map on app/mileage/page.tsx had the
 * same fault and is covered by components/mileage/MileageMap.ct.spec.tsx.
 * Both mount points now go through the same MileageMapRoutes wrapper, so
 * these two tests pin the wiring at THIS mount point rather than
 * re-testing the wrapper's own rules.
 */

/**
 * A `window.google.maps` good enough to record what reaches the map.
 * The loader resolves straight from the global when it is already there
 * (lib/maps/google-maps-loader.ts), so no key and no network is needed.
 * Same stub, and the same reason, as MileageMap.ct.spec.tsx.
 */
async function installFakeMaps(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __paths: [number, number][][];
      google: unknown;
    };
    w.__paths = [];
    class FakeMap {
      fitBounds() {}
      setCenter() {}
      setZoom() {}
      getZoom() {
        return 12;
      }
    }
    class FakeBounds {
      extend() {}
    }
    class FakePolyline {
      constructor(opts?: { path?: { lat: number; lng: number }[] }) {
        if (opts?.path) w.__paths.push(opts.path.map((p) => [p.lat, p.lng]));
      }
      setMap() {}
      setPath() {}
    }
    class FakeMarker {
      setMap() {}
    }
    w.google = {
      maps: {
        Map: FakeMap,
        LatLngBounds: FakeBounds,
        Polyline: FakePolyline,
        Marker: FakeMarker,
        SymbolPath: { CIRCLE: 0, FORWARD_CLOSED_ARROW: 1 },
        event: { addListenerOnce: () => ({ remove() {} }) },
      },
    };
  });
}

test("the drive log's own map asks for every route in one request, and draws them", async ({
  mount,
  page,
}) => {
  // Rows ask for their own thumbnails at this endpoint too, one id at a
  // time and only when they are near the viewport. The MAP's request is
  // the one that names more than one drive, which is the whole point:
  // three drives, one request, not three.
  const batches: string[][] = [];
  await page.route("**/api/mileage/drives*", (r) => {
    const url = new URL(r.request().url());
    const trip = url.searchParams.get("trip");
    if (trip === null) return r.fulfill({ json: { drives: [] } });
    const ids = trip.split(",").filter(Boolean);
    if (ids.length > 1) batches.push(ids);
    return r.fulfill({
      json: {
        points: ids.flatMap((id, n) => [
          { trip_id: id, lat: 40 + n, lng: -80, captured_at: "2026-09-20T10:00:00Z" },
          { trip_id: id, lat: 41 + n, lng: -81, captured_at: "2026-09-20T10:05:00Z" },
        ]),
      },
    });
  });
  await installFakeMaps(page);
  await mountLog(mount, page);

  await expect
    .poll(() => batches.length, { message: "the map never asked for its routes" })
    .toBe(1);
  expect(
    batches[0].slice().sort(),
    "every drive in the log must be in the one request",
  ).toEqual(["aaa", "bbb", "ccc"]);
  // And they reached the map. An empty `points` array was exactly what
  // this component used to hand over, and it renders as a map that
  // simply has nothing on it, which reads as "no drives yet".
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __paths: unknown[] }).__paths.length,
        ),
      { message: "no route was ever drawn" },
    )
    .toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(300);
  expect(batches.length, "one request for the map, not one per drive").toBe(1);
});

test("the drive log's own map draws nothing and reports nothing when the fetch fails", async ({
  mount,
  page,
}) => {
  await page.route("**/api/mileage/drives*", (r) => r.abort());
  await installFakeMaps(page);
  const c = await mountLog(mount, page);
  await page.waitForTimeout(300);
  // The drives themselves are already on the page; the routes are the
  // only thing missing, and a missing route is not an error.
  await expect(c).toContainText("4.2 mi");
  await expect(c).not.toContainText("Error");
  await expect(c).not.toContainText("undefined");
  expect(
    await page.evaluate(
      () => (window as unknown as { __paths: unknown[] }).__paths.length,
    ),
  ).toBe(0);
});

/**
 * One fetch for the whole log, map and rows together.
 *
 * The map's batch and the rows' lazy thumbnails wanted the same routes,
 * so a scrolled page of sixty drives fired up to sixty extra single-id
 * requests for routes this component was already holding, each at the
 * full 250-vertex budget. That is the cost this branch deleted from the
 * first paint, arriving through the scrollbar instead. These two tests
 * pin the property rather than the plumbing: what matters is how many
 * requests a full scroll costs, and that a row the batch could not cover
 * still gets its map.
 */

const MANY = Array.from({ length: 12 }, (_, i) => drive(`d-${i}`, i));

function mountDrives(
  mount: ComponentFixtures["mount"],
  list: ReturnType<typeof drive>[],
) {
  return mount(
    <div data-skin="instrument">
      <DriveLog
        initialDrives={list}
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

/** Two fixes for a drive, enough for a route with a direction. */
const fixes = (id: string, n: number) => [
  { trip_id: id, lat: 40 + n, lng: -80, captured_at: "2026-09-20T10:00:00Z" },
  { trip_id: id, lat: 41 + n, lng: -81, captured_at: "2026-09-20T10:05:00Z" },
];

/** Drag every row past the eye, which is what used to buy a request each. */
async function scrollEveryRow(page: Page, c: MountResult) {
  const boxes = c.locator("[data-drive-thumbnail]");
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    await boxes.nth(i).scrollIntoViewIfNeeded();
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(400);
}

test("scrolling the whole log costs one route request, not one per row", async ({
  mount,
  page,
}) => {
  const asks: string[][] = [];
  await page.route("**/api/mileage/drives*", (r) => {
    const url = new URL(r.request().url());
    const trip = url.searchParams.get("trip");
    if (trip === null) return r.fulfill({ json: { drives: [] } });
    const ids = trip.split(",").filter(Boolean);
    asks.push(ids);
    return r.fulfill({ json: { points: ids.flatMap((id, n) => fixes(id, n)) } });
  });
  await page.setViewportSize({ width: 390, height: 600 });
  const c = await mountDrives(mount, MANY);

  await expect
    .poll(() => asks.length, { message: "the log never asked for its routes" })
    .toBe(1);
  await scrollEveryRow(page, c);

  expect(
    asks.length,
    `twelve rows scrolled past the eye cost ${asks.length} requests; the batch ` +
      `already held every one of those routes`,
  ).toBe(1);
  expect(asks[0], "one request naming every drive in the log").toHaveLength(12);
  // And the rows drew the routes they were handed, rather than sitting
  // empty waiting for a request they were told not to make.
  await expect(c.locator('[data-drive-thumbnail="d-0"] *').first()).toBeVisible();
  await expect(
    c.locator('[data-drive-thumbnail="d-11"] *').first(),
  ).toBeVisible();
});

test("a row the batch could not cover still fetches its own route, and draws it", async ({
  mount,
  page,
}) => {
  // The route caps a batch, so a list longer than the cap gets routes for
  // the first ids and nothing for the rest. Here the cap is two. The
  // lazy per-row fetch is the right answer for the other three, and it
  // has to keep working: it is why the cap is safe.
  const COVERED = 2;
  const batches: string[][] = [];
  const singles: string[] = [];
  await page.route("**/api/mileage/drives*", (r) => {
    const url = new URL(r.request().url());
    const trip = url.searchParams.get("trip");
    if (trip === null) return r.fulfill({ json: { drives: [] } });
    const ids = trip.split(",").filter(Boolean);
    if (ids.length > 1) {
      batches.push(ids);
      const capped = ids.slice(0, COVERED);
      return r.fulfill({
        json: { points: capped.flatMap((id, n) => fixes(id, n)) },
      });
    }
    singles.push(ids[0]);
    return r.fulfill({ json: { points: fixes(ids[0], 7) } });
  });
  await page.setViewportSize({ width: 390, height: 600 });
  const c = await mountDrives(mount, MANY.slice(0, 5));

  await expect
    .poll(() => batches.length, { message: "the log never asked for its routes" })
    .toBe(1);
  await scrollEveryRow(page, c);

  expect(batches.length, "still one batch").toBe(1);
  expect(
    singles.slice().sort(),
    "every drive the batch did not cover, and only those, asked for itself",
  ).toEqual(["d-2", "d-3", "d-4"]);
  // Drawn, not merely fetched. An uncovered row that asks and then does
  // nothing with the answer is the same blank box as before.
  await expect(c.locator('[data-drive-thumbnail="d-4"] *').first()).toBeVisible();
  await expect(c.locator('[data-drive-thumbnail="d-0"] *').first()).toBeVisible();
});

test("a row does not ask for a route the log's batch is still fetching", async ({
  mount,
  page,
}) => {
  // The batch is held open for the whole scroll, which is the case the
  // other two cannot see: they answer it instantly, so the rows already
  // have their routes by the time they are looked at and would pass even
  // if they were willing to race. On a phone the answer takes a moment,
  // every visible row is observed inside that moment, and a row that
  // reads an empty array as "nothing is coming" asks for its own copy of
  // a route already on the wire.
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  const batches: string[][] = [];
  const singles: string[] = [];
  await page.route("**/api/mileage/drives*", async (r) => {
    const url = new URL(r.request().url());
    const trip = url.searchParams.get("trip");
    if (trip === null) return r.fulfill({ json: { drives: [] } });
    const ids = trip.split(",").filter(Boolean);
    if (ids.length > 1) {
      batches.push(ids);
      await held;
      return r.fulfill({
        json: { points: ids.flatMap((id, n) => fixes(id, n)) },
      });
    }
    singles.push(ids[0]);
    return r.fulfill({ json: { points: fixes(ids[0], 7) } });
  });
  await page.setViewportSize({ width: 390, height: 600 });
  const c = await mountDrives(mount, MANY);

  await expect
    .poll(() => batches.length, { message: "the log never asked for its routes" })
    .toBe(1);
  await scrollEveryRow(page, c);
  expect(
    singles,
    `${singles.length} rows asked for a route the batch was already fetching`,
  ).toEqual([]);

  release();
  // Back up the list. The rows that were deferred were never observed,
  // so they draw when they next come near the eye, which is the rule
  // this is not allowed to trade away for the saved request.
  await scrollEveryRow(page, c);
  await expect(c.locator('[data-drive-thumbnail="d-0"] *').first()).toBeVisible();
  await expect(
    c.locator('[data-drive-thumbnail="d-11"] *').first(),
  ).toBeVisible();
  expect(singles, "and none asked after it landed either").toEqual([]);
  expect(batches.length).toBe(1);
});

test("when the batch gives up, the rows are released to fetch their own", async ({
  mount,
  page,
}) => {
  // The batch is beyond saving: every attempt fails. The rows were
  // waiting for it (deferToList), and something has to let them go, or
  // the fix for one latch has built another one level down. Their own
  // per-row fetch is exactly the fallback that existed before the batch
  // did, and it still works.
  const singles: string[] = [];
  await page.route("**/api/mileage/drives*", (r) => {
    const url = new URL(r.request().url());
    const trip = url.searchParams.get("trip");
    if (trip === null) return r.fulfill({ json: { drives: [] } });
    const ids = trip.split(",").filter(Boolean);
    if (ids.length > 1) return r.abort();
    singles.push(ids[0]);
    return r.fulfill({ json: { points: fixes(ids[0], 3) } });
  });
  await page.setViewportSize({ width: 390, height: 600 });
  const c = await mountDrives(mount, MANY.slice(0, 3));

  // Past all three attempts and both backoffs.
  await expect(c.locator('[data-drive-thumbnail="d-0"] *').first()).toBeVisible({
    timeout: 15_000,
  });
  expect(
    singles,
    "a row left waiting on a batch that is never coming is the latch again",
  ).toContain("d-0");
});
