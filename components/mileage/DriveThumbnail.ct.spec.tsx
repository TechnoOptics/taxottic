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
  // Never a spinner that cannot resolve, and never a broken image.
  await expect(c.getByText("Loading")).toHaveCount(0);
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
