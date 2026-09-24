import { test, expect } from "@playwright/experimental-ct-react";
import { DriveThumbnail } from "./DriveThumbnail";
import { TripList, type TripRow } from "./TripList";

/**
 * A drive's map is decoration that pays for itself only when it is
 * about to be seen.
 *
 * The page used to fetch every row's polyline on the server before it
 * sent a byte, in a loop of up to sixty sequential database round trips,
 * for rows the reader may never scroll to. These three tests pin what
 * replaced it: nothing is asked for off screen, exactly one request is
 * ever made per row, and a row whose map never arrives is still a
 * readable drive.
 */

test("asks for nothing until it is near the viewport", async ({
  mount,
  page,
}) => {
  let calls = 0;
  await page.route("**/api/mileage/drives*", (r) => {
    calls += 1;
    return r.fulfill({ json: { points: [] } });
  });
  await page.setViewportSize({ width: 390, height: 600 });
  await mount(
    <div>
      <div style={{ height: 2000 }} />
      <DriveThumbnail tripId="t-1" />
    </div>,
  );
  await page.waitForTimeout(300);
  expect(calls, "a thumbnail 2000px down the page cost a request").toBe(0);
});

test("fetches once when scrolled to, and never twice", async ({
  mount,
  page,
}) => {
  let calls = 0;
  await page.route("**/api/mileage/drives*", (r) => {
    calls += 1;
    return r.fulfill({
      json: {
        points: [{ lat: 1, lng: 2, captured_at: "2026-09-20T10:00:00Z" }],
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 600 });
  // The spacer BELOW the thumbnail is what makes this test able to fail:
  // without a scrollable page the wheel events move nothing, the observer
  // never fires a second time, and a component with no "fetch once" guard
  // would pass anyway.
  await mount(
    <div>
      <DriveThumbnail tripId="t-1" />
      <div style={{ height: 3000 }} />
    </div>,
  );
  await page.waitForTimeout(400);
  expect(calls).toBe(1);
  // Far enough to clear the 200px rootMargin in both directions, so the
  // row genuinely leaves and re-enters the observed band.
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, -1200);
  await page.waitForTimeout(300);
  expect(calls, "scrolling past twice must not refetch").toBe(1);
});

/** The fields TripList's TripRow actually requires. */
function tripFixture(over: Partial<TripRow> = {}): TripRow {
  return {
    id: "t-1",
    startedAtISO: "2026-09-20T13:12:00.000Z",
    endedAtISO: "2026-09-20T13:41:00.000Z",
    distanceMiles: 22.7,
    classification: "business",
    deductionCents: 1521,
    needsConfirmation: false,
    // Empty on purpose: the page no longer ships polylines, the row's
    // thumbnail fetches its own.
    points: [],
    companyId: "c-1",
    ...over,
  };
}

test("a row whose polyline never arrives still reads as a drive", async ({
  mount,
  page,
}) => {
  // The thumbnail is decoration. If the fetch fails, or the row is
  // never scrolled to, the reader must still get the drive: how far it
  // went, when it ran, and what it is worth.
  await page.route("**/api/mileage/drives*", (r) => r.abort());
  await page.setViewportSize({ width: 390, height: 800 });
  const c = await mount(
    <div data-skin="instrument">
      <TripList
        trips={[tripFixture()]}
        reclassify={async () => {}}
        deleteTrip={async () => {}}
        onReview={() => {}}
        reviewingId={null}
        companies={[{ id: "c-1", name: "Acme" }]}
        moveTripCompany={async () => {}}
      />
    </div>,
  );
  await page.waitForTimeout(400);
  await expect(c).toContainText("22.7 mi");
  await expect(c).toContainText("$15.21 deduction");
  // The drive's day and its clock window, the other half of what a
  // reader checks a row for.
  await expect(c).toContainText("Sep 20");
  await expect(c).toContainText("→");
  // And it is still a row you can act on.
  await expect(c.getByRole("button", { name: "Mark this trip personal" })).toBeVisible();
  // Never a spinner that cannot resolve, and never a broken image, and
  // no endpoint line at all: this drive matched no saved place and its
  // route never came, so there is nothing honest to put there. "Unknown
  // start" next to "Unknown end" is a row that looks broken.
  await expect(c.getByText("Loading")).toHaveCount(0);
  await expect(c).not.toContainText("Unknown start");
  await expect(c).not.toContainText("Unknown end");
  expect(
    await page.evaluate(
      () =>
        Array.from(document.images).filter(
          (i) => i.complete && i.naturalWidth === 0,
        ).length,
    ),
    "a row with no polyline drew a broken image",
  ).toBe(0);
});

/**
 * Where the drive went, in the three states a row can be in.
 *
 * Places are information, not decoration (spec 4.1: "a row with no
 * polyline yet shows its distance, times and places"). mileage_trips
 * carries two saved-place uuids and no coordinates, so those two states
 * want different answers: a saved place is named from the id with no
 * network at all, an unsaved one is named from the polyline the
 * thumbnail was fetching anyway.
 */

const SAVED_START = { label: "Head Office", lat: 44.798, lng: -93.527 };
const SAVED_END = { label: "Hangar 4", lat: 45.105, lng: -93.208 };

/** Two unsaved fixes, and the labels the geocoder's own cache holds for
 *  them, so this test names places without a Google round trip. */
const UNSAVED = [
  { lat: 44.798, lng: -93.527, captured_at: "2026-09-20T13:12:00Z" },
  { lat: 45.105, lng: -93.208, captured_at: "2026-09-20T13:41:00Z" },
];
const GEOCODED = {
  "taxottic.revgeo2.44.7980,-93.5270": {
    short: "Shakopee, MN 55379",
    full: "Shakopee, MN 55379, USA",
  },
  "taxottic.revgeo2.45.1050,-93.2080": {
    short: "Mounds View, MN 55112",
    full: "Mounds View, MN 55112, USA",
  },
};

function listOf(trip: TripRow) {
  return (
    <div data-skin="instrument">
      <TripList
        trips={[trip]}
        reclassify={async () => {}}
        deleteTrip={async () => {}}
        onReview={() => {}}
        reviewingId={null}
        companies={[{ id: "c-1", name: "Acme" }]}
        moveTripCompany={async () => {}}
      />
    </div>
  );
}

test("a drive between two saved places names both before any route arrives", async ({
  mount,
  page,
}) => {
  // The polyline request is accepted and never answered, so anything on
  // screen below is on screen WITHOUT it. Google is blocked outright: a
  // saved place is a name the row already has, there is nothing to
  // geocode.
  let geocodeAttempts = 0;
  await page.route("**/api/mileage/drives*", () => {
    /* held open for the life of the test */
  });
  await page.route("**maps.googleapis.com**", (r) => {
    geocodeAttempts += 1;
    return r.abort();
  });
  await page.setViewportSize({ width: 390, height: 800 });
  const c = await mount(
    listOf(tripFixture({ startPlace: SAVED_START, endPlace: SAVED_END })),
  );
  await expect(c).toContainText("Head Office");
  await expect(c).toContainText("Hangar 4");
  await expect(c).toContainText("22.7 mi");
  // Proof that the names above did not come from the route: it never
  // answered, so the thumbnail box is still empty.
  await expect(c.locator("[data-drive-thumbnail] *")).toHaveCount(0);
  expect(geocodeAttempts, "a saved place does not need geocoding").toBe(0);
});

test("a drive between unsaved points names its ends when the thumbnail lands", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  // The geocoder's own localStorage cache, pre-seeded: these two fixes
  // resolve to real place names without a Google round trip, so the
  // assertion below is about the COORDINATES reaching the endpoints, not
  // about Google being reachable from a component test.
  await page.evaluate((entries) => {
    for (const [k, v] of Object.entries(entries)) {
      window.localStorage.setItem(k, JSON.stringify(v));
    }
  }, GEOCODED);

  // The polyline is held until this test lets it go, so the "before" of
  // this assertion is a real state and not a race.
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/mileage/drives*", async (r) => {
    await held;
    await r.fulfill({ json: { points: UNSAVED } });
  });

  const c = await mount(listOf(tripFixture()));
  // Distance and times are there from the first paint, with no route.
  await expect(c).toContainText("22.7 mi");
  await expect(c).toContainText("Sep 20");
  await expect(c).not.toContainText("Shakopee");

  release();
  await expect(c).toContainText("Shakopee, MN 55379");
  await expect(c).toContainText("Mounds View, MN 55112");
});

test("a drive whose fetch fails keeps its distance, its times and its saved name", async ({
  mount,
  page,
}) => {
  await page.route("**/api/mileage/drives*", (r) => r.abort());
  await page.route("**maps.googleapis.com**", (r) => r.abort());
  await page.setViewportSize({ width: 390, height: 800 });
  // One end saved, one not, and nothing to fill the other end with.
  const c = await mount(listOf(tripFixture({ startPlace: SAVED_START })));
  await expect(c).toContainText("22.7 mi");
  await expect(c).toContainText("Sep 20");
  await expect(c).toContainText("Head Office");
  // Honest about the half it does not know, rather than hiding the half
  // it does.
  await expect(c).toContainText("Unknown end");
  await expect(c.getByText("Locating route")).toHaveCount(0);
});
