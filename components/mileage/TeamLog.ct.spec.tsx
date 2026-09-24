import {
  test,
  expect,
  type ComponentFixtures,
} from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
import { TeamLog } from "./TeamLog";

/**
 * The manager's team overlay, which is the arm a manager of a 2+ person
 * team lands on by default.
 *
 * When the four range links became a client filter, this arm lost them
 * and got nothing back: the newest sixty drives on a map, with no way to
 * narrow them and no way to reach page two. These tests hold the window
 * control on the arm, and hold the map, the rollup and the total to
 * moving together when it is tapped, because a total that describes a
 * different set than the map beside it reads as authoritative and is
 * wrong on the first tap.
 */

const DAY = 86_400_000;
const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

function drive(id: string, driver: string, daysAgo: number, miles: number) {
  return {
    id,
    driver_user_id: driver,
    started_at: iso(daysAgo),
    ended_at: iso(daysAgo),
    distance_miles: miles,
    classification: "business" as const,
    tax_year: 2026,
    deduction_cents: Math.round(miles * 76),
    needs_confirmation: false,
    start_place_id: null,
    end_place_id: null,
    startPlace: null,
    endPlace: null,
  };
}

// One recent drive each, and one 40 days old, so a 7 day window changes
// what is drawn and a 92 day window reaches past everything loaded.
const DRIVES = [
  drive("a", "u-self", 1, 10),
  drive("b", "u-2", 2, 20),
  drive("c", "u-2", 40, 100),
];

const NAMES = { "u-self": "Abel · you", "u-2": "Grace Hopper" };

/** The Maps SDK, reduced to the two classes this measures: every polyline
 *  the map draws lands in `window.__paths`. */
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

/** How many DISTINCT trails the map has drawn. Distinct, because the map
 *  redraws whenever its props settle and a raw count would be a render
 *  count as much as a trail count. */
const drawnCount = (page: Page) =>
  page.evaluate(
    () =>
      new Set(
        (window as unknown as { __paths: unknown[][] }).__paths.map((p) =>
          JSON.stringify(p),
        ),
      ).size,
  );

const resetDrawn = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __paths: unknown[] }).__paths = [];
  });

async function mountTeam(mount: ComponentFixtures["mount"], page: Page) {
  await page.setViewportSize({ width: 390, height: 900 });
  return mount(
    <div data-skin="instrument">
      <TeamLog
        who="All drivers"
        where="Techno Optics LLC"
        awaiting={0}
        initialDrives={DRIVES}
        companyId="co-1"
        driverParam=""
        places={[]}
        driverNames={NAMES}
      />
    </div>,
  );
}

test("the team overlay has the window control, and it moves the map, the rollup and the total together", async ({
  mount,
  page,
}) => {
  await page.route("**/api/mileage/drives*", (r) => {
    const url = new URL(r.request().url());
    const trip = url.searchParams.get("trip");
    if (trip === null) return r.fulfill({ json: { drives: [] } });
    const ids = trip.split(",").filter(Boolean);
    return r.fulfill({
      json: {
        points: ids.flatMap((id, n) => [
          { trip_id: id, lat: 40 + n, lng: -80, captured_at: iso(1) },
          { trip_id: id, lat: 41 + n, lng: -81, captured_at: iso(1) },
        ]),
      },
    });
  });
  await installFakeMaps(page);
  const c = await mountTeam(mount, page);

  // All three drives, both drivers, and the total over every one of them.
  await expect(c.getByRole("group", { name: "Filter drives" })).toBeVisible();
  await expect(c).toContainText("3 drives");
  await expect(c).toContainText("130 mi");
  await expect(c.locator("li.card")).toHaveCount(2);
  await expect(c).toContainText("Grace Hopper");
  await expect
    .poll(() => drawnCount(page), { message: "the map never drew a trail" })
    .toBe(3);

  await resetDrawn(page);
  await c.getByRole("button", { name: "Last 7 days" }).click();

  // The head, the rollup and what the map is asked to draw all follow.
  await expect(c, "the total did not follow the window").toContainText(
    "30 mi",
  );
  await expect(c).toContainText("2 drives");
  await expect
    .poll(() => drawnCount(page), {
      message: "the map still draws a drive the chosen window dropped",
    })
    .toBe(2);
  const grace = c.locator("li.card", { hasText: "Grace Hopper" });
  await expect(
    grace,
    "the rollup still counts a drive the window dropped",
  ).toContainText("1 trip");
});

test("the team overlay can reach page two", async ({ mount, page }) => {
  const pages: URL[] = [];
  await page.route("**/api/mileage/drives*", (r) => {
    const url = new URL(r.request().url());
    if (url.searchParams.has("trip"))
      return r.fulfill({ json: { points: [] } });
    pages.push(url);
    return r.fulfill({
      json: { drives: [drive("d", "u-2", 120, 5)] },
    });
  });
  const c = await mountTeam(mount, page);

  // A window that reaches back past everything loaded is what makes the
  // control admit it may be showing fewer drives than exist.
  await c.getByRole("button", { name: /92 days/i }).click();
  const older = c.getByRole("button", { name: /Load more/i });
  await expect(
    older,
    "a manager had no way at all to reach page two on this arm",
  ).toBeVisible();
  await older.click();

  await expect.poll(() => pages.length).toBe(1);
  expect(pages[0].searchParams.get("company")).toBe("co-1");
  expect(
    pages[0].searchParams.get("before"),
    "the cursor lost its tie-break, so a drive tied with it is skipped for good",
  ).toBe(iso(40));
  expect(pages[0].searchParams.get("beforeId")).toBe("c");
  // The appended page is in the list, and under the 92 day window it is
  // out of it, which is the honest answer rather than a silent drop.
  await c.getByRole("button", { name: "All" }).click();
  await expect(c).toContainText("4 drives");
});

test("every control on the team overlay meets the tap floor", async ({
  mount,
  page,
}) => {
  await page.route("**/api/mileage/drives*", (r) =>
    r.fulfill({ json: { points: [] } }),
  );
  const c = await mountTeam(mount, page);
  const small = await c
    .locator("a, button, summary, [role=button]")
    .evaluateAll((els) =>
      els
        .map((el) => ({
          text: (el.textContent ?? "").trim().slice(0, 40),
          h: Math.round(el.getBoundingClientRect().height),
        }))
        .filter((m) => m.h > 0 && m.h < 44),
    );
  expect(small, `controls under 44px: ${JSON.stringify(small)}`).toEqual([]);
});
