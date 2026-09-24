import { TeamTrackingHealth } from "./TeamTrackingHealth";
import { TeamViewNote } from "./TeamViewNote";
import { DriverPicker } from "./DriverPicker";
import { MilesHead } from "./MilesHead";
import { DriveFilterHarness } from "./DriveFilter.ct.fixture";

// Mount fixture for MileageFirstPaint.ct.spec.tsx. Lives in its own file
// because Playwright CT can only mount components it imports; one defined
// inside the spec "cannot be mounted".

const SELF = "u-self";
const DRIVERS = [
  { userId: SELF, label: "Abel · you" },
  { userId: "u-2", label: "Grace Hopper · Field" },
  { userId: "u-3", label: "Marcus Aurelius · Field" },
];

// One teammate silent for 42h, the other two healthy: the exact state in
// the report. The alert only renders when someone needs attention, so
// this is the case that costs height. The silent phone carries the cause
// its own status row held all along (location_authorization =
// 'whenInUse' on iOS), so the row also renders the longest cause line.
const HEALTH = [
  { userId: SELF, label: "Abel · you", health: { status: "healthy" as const, ageMs: 5 * 60_000 } },
  {
    userId: "u-2",
    label: "Grace Hopper · Field",
    health: { status: "silent" as const, ageMs: 42 * 3_600_000 },
    cause: "authorization_downgraded" as const,
    platform: "ios",
  },
  { userId: "u-3", label: "Marcus Aurelius · Field", health: { status: "healthy" as const, ageMs: 20 * 60_000 } },
];

/**
 * The head of /mileage as a manager of a three-person team sees it, in
 * the same order and with the same wrappers app/mileage/page.tsx renders.
 *
 * The real components carry the parts this test exists to measure. The
 * chrome around them (the section wrappers, the map's top edge, the
 * cross-links below the list) is mirrored from the page because the page
 * is an async server component behind auth and cannot mount here. A
 * drift in the mirrored chrome would make this measurement inexact; it
 * cannot hide a regression in the components under test.
 *
 * THIS IS THE MANAGER'S TEAM OVERLAY, which is the branch the report came
 * from. That branch renders the head, the window filter, the map and a
 * per-driver rollup (TeamLog). The filter is the REAL control, because
 * the height it costs above the map is exactly what this test measures;
 * the map is still mirrored, being a Leaflet client component whose top
 * edge is all that matters here. The single-driver arm is measured at
 * 390px in MilesFirstDrive.ct.spec.tsx.
 *
 * RE-SYNCED BY TASK 6. What the head used to be, and what this fixture
 * therefore used to draw, was: a breadcrumb, a two-line title, a company
 * line, the alert, the picker, the Team view row, a "3 drives need a
 * quick call" card and a row of four pills. All of it is now one
 * MilesHead, and the Team view note moved below the list with the other
 * cross-links, which is why it is drawn down there.
 */
/** Enough drives, recent enough, that the default "All" window covers
 *  them and the honesty line stays hidden, the way a real first paint
 *  does. */
const TEAM_DRIVES = [
  { started_at: new Date(Date.now() - 86_400_000).toISOString() },
  { started_at: new Date(Date.now() - 3 * 86_400_000).toISOString() },
];

export function ManagerPageHead() {
  return (
    <main id="main" className="min-h-screen">
      {/* AppHeader is fixed and leaves this spacer in flow (AppHeader.tsx). */}
      <div aria-hidden="true" style={{ height: "3.25rem" }} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <MilesHead
          who="All drivers"
          where="Techno Optics LLC"
          miles={312.4}
          deductionCents={21868}
          driveCount={14}
          awaiting={3}
          switcher={
            <DriverPicker selfUserId={SELF} drivers={DRIVERS} current="all" />
          }
          tracking={<TeamTrackingHealth rows={HEALTH} />}
        />

        {/* The window control the team arm gained: four pills, and the
            load-older line only once a window reaches past the oldest
            drive loaded, which at first paint ("All") it does not. */}
        <div className="mt-4">
          <DriveFilterHarness drives={TEAM_DRIVES} />
        </div>

        {/* MileageMap is a Leaflet client component; only its top edge
            matters here, and the page gives it height={460}. */}
        <div data-ct="map" className="mt-4 rounded-2xl bg-forest-100" style={{ height: 460 }} />

        <div data-ct="more" className="mt-10 border-t border-edge pt-4">
          <h2 className="mono-label">More</h2>
          <nav aria-label="Mileage tools" className="mt-1 grid">
            <a
              href="/mileage/business"
              className="min-h-11 flex items-center text-sm underline decoration-dotted underline-offset-4"
            >
              Business breadcrumbs
            </a>
            <a
              href="/mileage/places"
              className="min-h-11 flex items-center text-sm underline decoration-dotted underline-offset-4"
            >
              Saved places
            </a>
            <a
              href="/mileage/schedule"
              className="min-h-11 flex items-center text-sm underline decoration-dotted underline-offset-4"
            >
              Schedule
            </a>
          </nav>
          <TeamViewNote selfUserId={SELF} />
        </div>
      </section>
    </main>
  );
}
