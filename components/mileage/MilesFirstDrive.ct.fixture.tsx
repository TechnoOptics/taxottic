import { TeamTrackingHealth } from "./TeamTrackingHealth";
import { DriverPicker } from "./DriverPicker";
import { DriveFilter } from "./DriveFilter";
import { TripList, type TripRow } from "./TripList";
import { MilesHead } from "./MilesHead";

/**
 * Mount fixture for MilesFirstDrive.ct.spec.tsx: the SINGLE-DRIVER arm of
 * /mileage at 390px, which is the width the owner's complaint was
 * measured at and the arm the team overlay fixture does not cover
 * (MileageFirstPaint.ct.fixture.tsx is the manager's team view at 344px).
 *
 * The real components carry what is measured. Leaflet is not mounted; the
 * page gives that map its default 420px and only its top edge matters
 * here.
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

export const TRIPS: TripRow[] = [
  {
    id: "t-1",
    startedAtISO: "2026-09-22T13:12:00Z",
    endedAtISO: "2026-09-22T13:41:00Z",
    distanceMiles: 22.7,
    classification: "unclassified",
    deductionCents: 0,
    needsConfirmation: false,
    points: [],
    companyId: "c-1",
  },
  {
    id: "t-2",
    startedAtISO: "2026-09-21T09:02:00Z",
    endedAtISO: "2026-09-21T09:31:00Z",
    distanceMiles: 14.2,
    classification: "business",
    deductionCents: 1080,
    needsConfirmation: false,
    points: [],
    companyId: "c-1",
  },
];

export function DriverPageHead() {
  return (
    <main id="main" className="min-h-screen">
      {/* AppHeader is fixed and leaves this spacer in flow (AppHeader.tsx). */}
      <div aria-hidden="true" style={{ height: "3.25rem" }} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <MilesHead
          who="Your drives"
          where="Techno Optics LLC"
          miles={14.2}
          deductionCents={1080}
          driveCount={2}
          awaiting={3}
          switcher={
            <DriverPicker selfUserId={SELF} drivers={DRIVERS} current={SELF} />
          }
          tracking={<TeamTrackingHealth rows={HEALTH} />}
        />

        {/* DriveLog: the window filter, then MileageReview's map and list. */}
        <div className="mt-4">
          <DriveFilter drives={[]} onChange={() => {}} />
        </div>
        <div className="mt-6">
          <div data-ct="map" className="rounded-2xl bg-forest-100" style={{ height: 420 }} />
        </div>
        <h2 className="display text-xl text-forest-900 mt-8">Trips</h2>
        <TripList
          trips={TRIPS}
          reclassify={async () => {}}
          deleteTrip={async () => {}}
          onReview={() => {}}
          reviewingId={null}
          companies={[{ id: "c-1", name: "Acme" }]}
          moveTripCompany={async () => {}}
        />
      </section>
    </main>
  );
}
