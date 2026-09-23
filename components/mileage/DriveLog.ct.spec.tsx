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
        who="Your drives"
        awaiting={0}
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
        who="Your drives"
        awaiting={0}
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

/**
 * THE TOTAL DESCRIBES WHAT IS ON SCREEN.
 *
 * The miles and the deduction used to be computed on the server, over
 * every loaded drive, and rendered in a head that sat above a filter it
 * knew nothing about: a tap on "Last 7 days" changed the list and left
 * the figures quoting a different set. A total that reads as
 * authoritative and describes some other set is worse than no total, so
 * the two have to move together or this test fails.
 */
test("a filter tap moves the list and the total together", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  // Two drives inside the week, two well outside it. 4.2 mi and 319
  // cents each (drive()), so the week is half of everything.
  const c = await mount(
    <div data-skin="instrument">
      <DriveLog
        who="Your drives"
        where="Acme"
        awaiting={7}
        initialDrives={[drive("d-1", 1), drive("d-2", 2), drive("d-3", 40), drive("d-4", 41)]}
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

  const rows = c.locator("li.card");
  await expect(rows).toHaveCount(4);
  await expect(c).toContainText("16.8 mi");
  await expect(c).toContainText("$12.76");
  await expect(c).toContainText("4 drives");

  await c.getByRole("button", { name: "Last 7 days" }).click();

  await expect(rows).toHaveCount(2);
  await expect(c).toContainText("8.4 mi");
  await expect(c).toContainText("$6.38");
  await expect(c).toContainText("2 drives");
  // The waiting count is NOT filtered with them. It counts every date on
  // purpose: the page opens on the newest drives and a driver holding
  // ten older ones was being told they were caught up.
  await expect(c).toContainText("7 waiting");
});

/**
 * A FILTER TAP COSTS NOTHING.
 *
 * This is the complaint the branch exists to answer. The range controls
 * were Links on a force-dynamic page: a tap started a full server render
 * and nothing on screen moved until it came back, which reads as a dead
 * control. They filter loaded drives in the browser now, and the
 * property that makes that true is that NOTHING on a tap touches the
 * network.
 *
 * Nothing else in this suite holds that property where it can break.
 * DriveFilter.ct.spec.tsx counts requests but mounts the buttons alone,
 * which can only ever prove that an isolated button does not fetch; the
 * test above proves the list and the total move but counts nothing. The
 * regression lives between them, in what this component re-arms when the
 * shown set changes, so it is asserted here.
 *
 * Two things make the count honest:
 *
 *   1. Every request is recorded off `page.on("request")`, not off a
 *      route matcher, so a request this file forgot to stub still
 *      counts.
 *   2. The baseline is taken at QUIESCENCE, not after a fixed sleep.
 *      The mount's own batch (and, if it fails, its retries) must have
 *      finished before a tap can be blamed for anything still in flight.
 *
 * And the batch ANSWERS WITH ROUTES, which is the ordinary case. A batch
 * that answers empty releases every row to fetch its own, by design (see
 * "a row the batch could not cover still fetches its own route" above),
 * and a row scrolled into view by a tap would then be charged to the tap
 * when it is the cost of being uncovered. Measured: with an empty answer
 * this same sequence records one request, and it is a row's, not the
 * filter's.
 */
test("a filter tap costs no network request at all", async ({
  mount,
  page,
}) => {
  // EVERY request, not just the ones to /api/. A filter that went back
  // to navigating would ask for a PAGE, and a counter that only watches
  // the API would wave that through: the regression is "the tap goes to
  // the server", not "the tap goes to that one route". Mutation-proved
  // against both shapes.
  const asked: string[] = [];
  page.on("request", (r) => asked.push(r.method() + " " + r.url()));
  await page.route("**/api/mileage/drives*", (r) => {
    const url = new URL(r.request().url());
    const trip = url.searchParams.get("trip");
    if (trip === null) return r.fulfill({ json: { drives: [] } });
    const ids = trip.split(",").filter(Boolean);
    return r.fulfill({
      json: { points: ids.flatMap((id, n) => fixes(id, n)) },
    });
  });
  await page.setViewportSize({ width: 390, height: 800 });
  // Two drives inside the week, two well outside it, so every tap moves
  // the list rather than leaving it where it was.
  const c = await mountDrives(mount, [
    drive("d-1", 1),
    drive("d-2", 2),
    drive("d-3", 40),
    drive("d-4", 70),
  ]);

  /** Settled means: two seconds with no new request. */
  const quiet = async () => {
    for (;;) {
      const n = asked.length;
      await page.waitForTimeout(2000);
      if (asked.length === n) return;
    }
  };
  await quiet();
  const onMount = asked.length;
  const api = asked.filter((u) => u.includes("/api/"));
  expect(
    api.length,
    `mounting the log cost ${api.length} API requests: ${api.join(", ")}`,
  ).toBe(1);

  const controls = c
    .getByRole("group", { name: "Filter drives" })
    .getByRole("button");
  const seen: number[] = [];
  for (let i = 0; i < (await controls.count()); i++) {
    await controls.nth(i).click();
    await page.waitForTimeout(400);
    seen.push(await c.locator("li.card").count());
  }
  await quiet();

  expect(
    asked.length - onMount,
    `four filter taps cost ${asked.length - onMount} requests: ` +
      asked.slice(onMount).join(", "),
  ).toBe(0);
  // Paired half: a tap that changes nothing trivially costs nothing, so
  // the taps above have to have moved the list for the zero to mean
  // anything. All / 7 / 31 / 92 days over this set is 4 / 2 / 2 / 4.
  expect(seen, "the filter did not move the list").toEqual([4, 2, 2, 4]);
});

/**
 * The map is below the drives, not above them. 420px of it used to sit
 * between the filter and the first row.
 */
test("the drives come before the map, not after it", async ({
  mount,
  page,
}) => {
  // `{ points: [] }` is the route's contract (loadRoutes in
  // MileageMap.tsx). A body with any other key reads as NO ANSWER, which
  // costs three batch attempts and a per-row fallback: the give-up path,
  // not the ordinary one this test means to stand on.
  await page.route("**/api/mileage/drives*", (r) =>
    r.fulfill({ json: { points: [] } }),
  );
  const c = await mountLog(mount, page);
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
    };
  });
  console.log("DRIVE LOG order:", JSON.stringify(m));
  expect(m.head).toBeLessThan(m.filter);
  expect(m.filter).toBeLessThan(m.firstRow);
  expect(
    m.firstRow,
    `the first drive row starts at ${m.firstRow}px, below the map`,
  ).toBeLessThan(m.map);
  await expect(c).toBeVisible();
});

/**
 * THE COUNT AND ITS DESTINATION AGREE.
 *
 * `countDrivesAwaitingDecision` counts by driver across every company
 * and every date. `#first-unclassified` is placed by TripList among the
 * drives actually rendered: one page, one company, after this
 * component's filter. When those two sets differ, the anchor the head
 * would use is not in the document at all, and the tap does nothing:
 * the dead control this whole screen was rebuilt to remove, rebuilt in
 * its replacement. So the anchor is promised only when every waiting
 * drive is on screen, and the deck takes the tap otherwise.
 */
test("a count larger than the rows on screen sends the reader to the deck", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  // One waiting drive rendered, three waiting in total: the other two
  // are in another company, or past page one, or outside the filter.
  const c = await mount(
    <div data-skin="instrument">
      <DriveLog
        who="Your drives"
        awaiting={3}
        initialDrives={[
          { ...drive("d-1", 1), classification: "unclassified" as const },
          drive("d-2", 2),
        ]}
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
  const link = c.getByRole("link", { name: /waiting/ });
  await expect(link).toHaveAttribute("href", "/mileage/classify");
  // And the deck is a real place, unlike an anchor that is not here.
  expect(await page.locator("#first-unclassified").count()).toBe(1);
});

test("the anchor is promised only while every waiting drive is on screen", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  // Both waiting drives are rendered, so the head can point at the first
  // of them. One of them is 40 days old, which the week filter drops.
  const c = await mount(
    <div data-skin="instrument">
      <DriveLog
        who="Your drives"
        awaiting={2}
        initialDrives={[
          { ...drive("d-1", 1), classification: "unclassified" as const },
          { ...drive("d-2", 40), classification: "unclassified" as const },
        ]}
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
  const link = c.getByRole("link", { name: /waiting/ });
  await expect(link).toHaveAttribute("href", "#first-unclassified");

  // The filter drops the older one. The count still says two, because it
  // counts every date on purpose, so the anchor stops being honest and
  // the destination changes with it.
  await c.getByRole("button", { name: "Last 7 days" }).click();
  await expect(c.locator("li.card")).toHaveCount(1);
  await expect(link).toContainText("2 waiting");
  await expect(link).toHaveAttribute("href", "/mileage/classify");
});

/**
 * THE SERVER STILL OWNS PAGE ONE.
 *
 * Every classification on this screen is a server action followed by
 * `revalidatePath("/mileage")`, which re-renders the page and hands this
 * component a fresh `initialDrives`. Seeding state from that prop once
 * threw every one of those re-renders away: the action succeeded, the
 * row kept `aria-pressed="false"`, the total stayed at zero and the
 * deduction never appeared. Only the waiting count moved, because it is
 * a pass-through prop, so the number dropped while the row it pointed at
 * did not change.
 *
 * So this re-renders with the SAME drive reclassified and holds the row,
 * the total and the deduction to moving together.
 */
test("a reclassified drive reaches the row, the total and the deduction", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route("**/api/mileage/drives*", (r) =>
    r.fulfill({ json: { points: [] } }),
  );
  type Drive = ReturnType<typeof drive>;
  const before: Drive = {
    ...drive("d-1", 1),
    classification: "unclassified" as Drive["classification"],
    deduction_cents: 0,
  };
  const log = (d: Drive, awaiting: number) => (
    <div data-skin="instrument">
      <DriveLog
        who="Your drives"
        awaiting={awaiting}
        initialDrives={[d]}
        initialExcluded={[]}
        companyId="co-1"
        driverParam=""
        places={[]}
        reclassify={noop}
        deleteTrip={noop}
        companies={[{ id: "co-1", name: "Acme" }]}
        moveTripCompany={noop}
      />
    </div>
  );
  const c = await mount(log(before, 1));

  const business = c.getByRole("button", { name: "Mark this trip business" });
  await expect(business).toHaveAttribute("aria-pressed", "false");
  await expect(c).toContainText("0 mi");
  await expect(c).toContainText("$0.00");

  // What the server sends back after the action: the same drive, filed.
  await c.update(
    log(
      {
        ...before,
        classification: "business" as Drive["classification"],
        deduction_cents: 1080,
        distance_miles: 14.2,
      },
      0,
    ),
  );

  await expect(
    business,
    "the row still reads unclassified after the server said otherwise",
  ).toHaveAttribute("aria-pressed", "true");
  await expect(c, "the total did not follow the row").toContainText("14.2 mi");
  await expect(c, "the deduction did not follow the row").toContainText(
    "$10.80",
  );
  await expect(c.getByRole("link", { name: /waiting/ })).toHaveCount(0);
});

/**
 * The same rule for a DELETED drive: the server drops it from page one,
 * and the list must drop it too.
 */
test("a deleted drive leaves the list when the server drops it", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route("**/api/mileage/drives*", (r) =>
    r.fulfill({ json: { points: [] } }),
  );
  const log = (drives: ReturnType<typeof drive>[]) => (
    <div data-skin="instrument">
      <DriveLog
        who="Your drives"
        awaiting={0}
        initialDrives={drives}
        initialExcluded={[]}
        companyId="co-1"
        driverParam=""
        places={[]}
        reclassify={noop}
        deleteTrip={noop}
        companies={[{ id: "co-1", name: "Acme" }]}
        moveTripCompany={noop}
      />
    </div>
  );
  const c = await mount(log([drive("d-1", 1), drive("d-2", 2)]));
  await expect(c.locator("li.card")).toHaveCount(2);

  await c.update(log([drive("d-2", 2)]));
  await expect(
    c.locator("li.card"),
    "the deleted drive is still in the list",
  ).toHaveCount(1);
});

/**
 * THE BATCH SAYS WHICH LOG IT CAME OUT OF.
 *
 * The drives route serves a bare `?trip=` strictly to the caller, so a
 * batch that names no company gets the caller's own routes and nothing
 * else. That is right for a lone guessable uuid and wrong for a list the
 * server itself scoped: a manager reading a teammate's log would get a
 * blank thumbnail on every row and a trail-less review map, and the team
 * overlay would draw the manager's own trails only.
 *
 * The scope is resolved on the SERVER from the caller's own membership.
 * What travels here is only which question to ask.
 */
test("the route batch names the company and the driver the log was read under", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const batches: URL[] = [];
  await page.route("**/api/mileage/drives*", (r) => {
    const url = new URL(r.request().url());
    if (url.searchParams.has("trip")) batches.push(url);
    return r.fulfill({ json: { points: [] } });
  });
  await mount(
    <div data-skin="instrument">
      <DriveLog
        who="Grace Hopper"
        awaiting={0}
        initialDrives={DRIVES}
        initialExcluded={[]}
        companyId="co-1"
        driverParam="u-2"
        places={[]}
        reclassify={noop}
        deleteTrip={noop}
        companies={[{ id: "co-1", name: "Acme" }]}
        moveTripCompany={noop}
      />
    </div>,
  );

  await expect.poll(() => batches.length).toBeGreaterThan(0);
  expect(
    batches[0].searchParams.get("company"),
    "an unscoped batch is served the caller's own routes only",
  ).toBe("co-1");
  expect(
    batches[0].searchParams.get("driver"),
    "the teammate the log was pinned to must reach the batch too",
  ).toBe("u-2");
});
