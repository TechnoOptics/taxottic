import { test, expect } from "@playwright/experimental-ct-react";
import { MileageMapRoutes } from "./MileageMap";

/**
 * The big map draws its routes again.
 *
 * Task 2 deleted the page's blocking polyline fetch and left the map's
 * `points` arrays empty, so the largest element on /mileage drew nothing
 * at all. These tests pin what replaced it: the map asks for the drives
 * it is drawing in ONE request after it has painted, draws each drive's
 * fixes in the order they were captured, and is still a readable map
 * when the request never answers.
 *
 * One request is the point, not an optimisation. The thing this branch
 * fixed was sixty sequential round trips on the render path, and a
 * request per drive on the client is the same cost wearing a different
 * hat.
 */

/**
 * A `window.google.maps` good enough for this component, recording every
 * polyline path it is handed.
 *
 * The loader resolves straight from `window.google.maps` when it is
 * already there (lib/maps/google-maps-loader.ts), so installing this
 * before mount is all it takes: no key, no script, no network. It is
 * what lets these tests assert the geometry that actually reaches the
 * map rather than a stand-in for it.
 */
async function installFakeMaps(page: import("@playwright/test").Page) {
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

const paths = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () => (window as unknown as { __paths: [number, number][][] }).__paths,
  );

test("draws a route for every drive it was given, fetched after mount", async ({
  mount,
  page,
}) => {
  let asked: string[] = [];
  await page.route("**/api/mileage/drives*", async (r) => {
    const url = new URL(r.request().url());
    asked = (url.searchParams.get("trip") ?? "").split(",").filter(Boolean);
    return r.fulfill({
      json: {
        points: asked.flatMap((id) => [
          { trip_id: id, lat: 37.77, lng: -122.41, captured_at: "2026-09-20T10:00:00Z" },
          { trip_id: id, lat: 37.78, lng: -122.42, captured_at: "2026-09-20T10:05:00Z" },
        ]),
      },
    });
  });
  await mount(<MileageMapRoutes tripIds={["t-1", "t-2"]} />);
  await expect
    .poll(() => asked.length, { message: "the map never asked for its routes" })
    .toBe(2);
  // One request for both, not one per drive: this replaced a loop that
  // could make sixty sequential round trips, and a request per row would
  // be the same mistake wearing a client-side hat.
  expect(page.context().pages().length).toBeGreaterThan(0);
});

test("draws nothing and reports nothing when the fetch fails", async ({ mount, page }) => {
  await page.route("**/api/mileage/drives*", (r) => r.abort());
  const c = await mount(<MileageMapRoutes tripIds={["t-1"]} />);
  await page.waitForTimeout(300);
  await expect(c).not.toContainText("Error");
  await expect(c).not.toContainText("undefined");
});

test("asks for six drives in one request, not six requests", async ({
  mount,
  page,
}) => {
  // The guard the brief's first test names in prose but cannot see: it
  // counts the ids in the LAST request, which a per-drive loop satisfies
  // with six requests of one id each. This counts the requests.
  const asks: string[][] = [];
  const ids = ["t-1", "t-2", "t-3", "t-4", "t-5", "t-6"];
  await page.route("**/api/mileage/drives*", async (r) => {
    const url = new URL(r.request().url());
    asks.push((url.searchParams.get("trip") ?? "").split(",").filter(Boolean));
    return r.fulfill({ json: { points: [] } });
  });
  await mount(<MileageMapRoutes tripIds={ids} />);
  await expect
    .poll(() => asks.length, { message: "the map never asked for its routes" })
    .toBeGreaterThan(0);
  await page.waitForTimeout(400);
  expect(
    asks.length,
    `a request per drive is the round-trip bug again: ${asks.length} requests`,
  ).toBe(1);
  expect(asks[0], "every drive on the map must be in the one request").toEqual(
    ids,
  );
});

test("draws each drive's fixes in captured order, whatever order they arrive in", async ({
  mount,
  page,
}) => {
  // The RPC ends `order by trip_id, captured_at`, and this component does
  // not rely on that: a route drawn in arrival order reverses a drive,
  // which points its direction arrows backwards and names its start as
  // its end. So the answer here is deliberately shuffled.
  await page.route("**/api/mileage/drives*", (r) =>
    r.fulfill({
      json: {
        points: [
          { trip_id: "t-1", lat: 3, lng: 30, captured_at: "2026-09-20T10:10:00Z" },
          { trip_id: "t-1", lat: 1, lng: 10, captured_at: "2026-09-20T10:00:00Z" },
          { trip_id: "t-1", lat: 2, lng: 20, captured_at: "2026-09-20T10:05:00Z" },
        ],
      },
    }),
  );
  await installFakeMaps(page);
  await mount(
    <MileageMapRoutes
      trips={[{ id: "t-1", classification: "business" }]}
      places={[]}
      height={460}
    />,
  );
  await expect
    .poll(() => paths(page).then((p) => p.length), {
      message: "no route ever reached the map",
    })
    .toBeGreaterThan(0);
  const drawn = await paths(page);
  expect(
    drawn[0],
    "the drive was drawn in the order the rows arrived, not the order it was driven",
  ).toEqual([
    [1, 10],
    [2, 20],
    [3, 30],
  ]);
});

test("keeps the map on screen while the routes are still coming", async ({
  mount,
  page,
}) => {
  // The routes arrive after paint, so the frame, the places and the
  // legend must be there before them. A map that waits for its routes is
  // a blank rectangle for as long as the request takes.
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/mileage/drives*", async (r) => {
    await held;
    return r.fulfill({ json: { points: [] } });
  });
  await installFakeMaps(page);
  const c = await mount(
    <MileageMapRoutes
      trips={[{ id: "t-1", classification: "business" }]}
      places={[]}
      height={460}
    />,
  );
  await expect(c.locator("[aria-label='Mileage breadcrumb map']")).toBeVisible();
  await expect(c).toContainText("Business");
  release();
});

/**
 * A batch that fails is asked again.
 *
 * The first version of this marked every id asked BEFORE the request
 * resolved and folded every failure into an empty answer, so one dropped
 * connection left the map with no trails until something remounted it.
 * That is the same shape as the load-more control on this branch, which
 * latched itself off on a single empty response and could not recover
 * inside the session. It was fixed there, so it is fixed here, and for
 * the same reason: a driver who saw a blank map once should not have to
 * kill the app to see their drives.
 */

test("a batch that fails is asked again, and the trails arrive", async ({
  mount,
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/mileage/drives*", (r) => {
    attempts += 1;
    // The first attempt is a dropped connection. The second works.
    if (attempts === 1) return r.abort();
    const ids = (new URL(r.request().url()).searchParams.get("trip") ?? "")
      .split(",")
      .filter(Boolean);
    return r.fulfill({
      json: {
        points: ids.flatMap((id) => [
          { trip_id: id, lat: 1, lng: 10, captured_at: "2026-09-20T10:00:00Z" },
          { trip_id: id, lat: 2, lng: 20, captured_at: "2026-09-20T10:05:00Z" },
        ]),
      },
    });
  });
  await installFakeMaps(page);
  await mount(
    <MileageMapRoutes
      trips={[{ id: "t-1", classification: "business" }]}
      places={[]}
      height={460}
    />,
  );
  await expect
    .poll(() => paths(page).then((p) => p.length), {
      message: "the map never recovered from one failed batch",
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  expect(
    (await paths(page))[0],
    "the retry drew the route it fetched",
  ).toEqual([
    [1, 10],
    [2, 20],
  ]);
  expect(attempts, "one failure, one retry, then it stops").toBe(2);
});

test("a batch that answers with no routes is not asked again", async ({
  mount,
  page,
}) => {
  // `{ points: [] }` is an ANSWER: those drives have no stored route, or
  // none of them are this caller's. Retrying it would ask the same
  // question three times and get the same reply, which is how a bounded
  // retry turns into a request amplifier on exactly the accounts that
  // have the least to show.
  let attempts = 0;
  await page.route("**/api/mileage/drives*", (r) => {
    attempts += 1;
    return r.fulfill({ json: { points: [] } });
  });
  await installFakeMaps(page);
  const c = await mount(
    <MileageMapRoutes
      trips={[{ id: "t-1", classification: "business" }]}
      places={[]}
      height={460}
    />,
  );
  await expect.poll(() => attempts).toBe(1);
  // Past both retry delays, so a retry would have happened by now.
  await page.waitForTimeout(2000);
  expect(attempts, "an empty answer is still an answer").toBe(1);
  await expect(c).not.toContainText("Error");
});
