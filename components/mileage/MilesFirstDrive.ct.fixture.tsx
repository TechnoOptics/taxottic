import { TeamTrackingHealth } from "./TeamTrackingHealth";
import { DriverPicker } from "./DriverPicker";
import { DriveLog } from "./DriveLog";
import { TeamViewNote } from "./TeamViewNote";
import type { SentDrive } from "@/app/api/mileage/drives/route";

/**
 * Mount fixture for MilesFirstDrive.ct.spec.tsx: the SINGLE-DRIVER arm of
 * /mileage at 390px, which is the width the owner's complaint was
 * measured at and the arm the team overlay fixture does not cover
 * (MileageFirstPaint.ct.fixture.tsx is the manager's team view at 344px).
 *
 * The whole drive log is the REAL component here, head, filter, rows and
 * map, so the distances this measures are the ones the page produces.
 * Only the section wrappers and the links below the list are mirrored
 * from app/mileage/page.tsx, which is an async server component behind
 * auth and cannot mount.
 */

const SELF = "u-self";
const DRIVERS = [
  { userId: SELF, label: "Abel · you" },
  { userId: "u-2", label: "Grace Hopper · Field" },
];
const HEALTH = [
  { userId: SELF, label: "Abel · you", health: { status: "healthy" as const, ageMs: 5 * 60_000 } },
  {
    userId: "u-2",
    label: "Grace Hopper · Field",
    health: { status: "silent" as const, ageMs: 42 * 3_600_000 },
    cause: "authorization_downgraded" as const,
    platform: "ios",
  },
];

const DAY = 86_400_000;
const iso = (daysAgo: number, hour: number) =>
  new Date(
    new Date(Date.now() - daysAgo * DAY).setUTCHours(hour, 12, 0, 0),
  ).toISOString();

function drive(over: Partial<SentDrive> & { id: string }): SentDrive {
  return {
    driver_user_id: SELF,
    started_at: iso(1, 13),
    ended_at: iso(1, 14),
    distance_miles: 22.7,
    classification: "unclassified",
    tax_year: 2026,
    deduction_cents: 0,
    needs_confirmation: false,
    start_place_id: null,
    end_place_id: null,
    startPlace: null,
    endPlace: null,
    ...over,
  };
}

export const DRIVES: SentDrive[] = [
  drive({ id: "t-1" }),
  drive({
    id: "t-2",
    started_at: iso(2, 9),
    ended_at: iso(2, 10),
    distance_miles: 14.2,
    classification: "business",
    deduction_cents: 1080,
  }),
];

const noop = async () => {};

export function DriverPageHead() {
  return (
    <main id="main" className="min-h-screen">
      {/* AppHeader is fixed and leaves this spacer in flow (AppHeader.tsx). */}
      <div aria-hidden="true" style={{ height: "3.25rem" }} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <DriveLog
          who="Your drives"
          where="Techno Optics LLC"
          awaiting={3}
          switcher={
            <DriverPicker selfUserId={SELF} drivers={DRIVERS} current={SELF} />
          }
          tracking={<TeamTrackingHealth rows={HEALTH} />}
          initialDrives={DRIVES}
          initialExcluded={[]}
          companyId="c-1"
          driverParam=""
          places={[]}
          reclassify={noop}
          deleteTrip={noop}
          companies={[{ id: "c-1", name: "Acme" }]}
          moveTripCompany={noop}
        />

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
