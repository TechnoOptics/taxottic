import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { MileageMap, type MapTrip, type MapPlace } from "@/components/mileage/MileageMap";

// Account-manager mileage map. Across every company the firm has
// an engagement with, the team's driving trails (colour-coded
// business/personal) + a per-driver deduction rollup. Reuses the
// same <MileageMap>. Reads via the service-role client scoped to
// the firm's engaged company IDs (the firm-cockpit pattern; RLS
// also permits firm reads via firm_has_active_engagement_with).

export const dynamic = "force-dynamic";

type SP = Promise<{ range?: string }>;
const RANGES: Record<string, { label: string; days: number }> = {
  week: { label: "This week", days: 7 },
  month: { label: "This month", days: 31 },
  quarter: { label: "Quarter", days: 92 },
  year: { label: "Year", days: 366 },
};

const usd = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const mi = (m: number) =>
  m.toLocaleString("en-US", { maximumFractionDigits: 1 });

export default async function FirmMileagePage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const { user, admin } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const { range = "month" } = await searchParams;
  const r = RANGES[range] ?? RANGES.month;
  const sinceIso = new Date(
    new Date().getTime() - r.days * 86_400_000,
  ).toISOString();

  const { data: engs } = await admin
    .from("firm_engagements")
    .select("company_id, company:companies!inner(id, name)")
    .eq("firm_id", ctx.firm.id);
  type Eng = { company_id: string; company: { id: string; name: string } };
  const engagements = (engs ?? []) as unknown as Eng[];
  const companyIds = Array.from(
    new Set(engagements.map((e) => e.company_id)),
  );
  const companyName = new Map<string, string>();
  for (const e of engagements) companyName.set(e.company.id, e.company.name);

  type TripRow = {
    id: string;
    company_id: string;
    driver_user_id: string;
    started_at: string;
    distance_miles: number;
    classification: "business" | "personal" | "unclassified";
    deduction_cents: number;
    mileage_points: { lat: number; lng: number; captured_at: string }[];
  };
  let trips: TripRow[] = [];
  let places: MapPlace[] = [];
  if (companyIds.length > 0) {
    const { data: tripData } = await admin
      .from("mileage_trips")
      .select(
        "id, company_id, driver_user_id, started_at, distance_miles, classification, deduction_cents, mileage_points(lat, lng, captured_at)",
      )
      .in("company_id", companyIds)
      .gte("started_at", sinceIso)
      .order("started_at", { ascending: false })
      .limit(1000);
    trips = (tripData ?? []) as unknown as TripRow[];

    const { data: placeData } = await admin
      .from("mileage_places")
      .select("id, kind, label, lat, lng")
      .in("company_id", companyIds);
    places = (placeData ?? []) as unknown as MapPlace[];
  }

  // Per-driver rollup.
  const driverIds = Array.from(new Set(trips.map((t) => t.driver_user_id)));
  const { data: profs } = driverIds.length
    ? await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", driverIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const driverLabel = new Map<string, string>();
  for (const p of profs ?? [])
    driverLabel.set(p.id, p.full_name?.trim() || p.email || p.id.slice(0, 8));

  const byDriver = new Map<
    string,
    { miles: number; deduction: number; trips: number }
  >();
  for (const t of trips) {
    const k = t.driver_user_id;
    const cur = byDriver.get(k) ?? { miles: 0, deduction: 0, trips: 0 };
    cur.trips += 1;
    if (t.classification === "business") {
      cur.miles += Number(t.distance_miles);
      cur.deduction += Number(t.deduction_cents);
    }
    byDriver.set(k, cur);
  }
  const totalDeduction = trips
    .filter((t) => t.classification === "business")
    .reduce((a, t) => a + Number(t.deduction_cents), 0);

  const mapTrips: MapTrip[] = trips.map((t) => ({
    id: t.id,
    classification: t.classification,
    // Per-driver colouring on the team map: each teammate's trails get a
    // unique colour (MileageMap assigns one per driver when 2+ are shown).
    driverId: t.driver_user_id,
    driverName: driverLabel.get(t.driver_user_id) ?? null,
    points: [...t.mileage_points]
      .sort((a, b) => a.captured_at.localeCompare(b.captured_at))
      .map((p) => ({ lat: p.lat, lng: p.lng })),
  }));

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          · Mileage
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Team mileage map
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          {ctx.firm.name} · {companyIds.length} client
          {companyIds.length === 1 ? "" : "s"} ·{" "}
          {r.label.toLowerCase()} · {usd(totalDeduction)} deductible
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(RANGES).map(([k, v]) => (
            <Link
              key={k}
              href={`/firm/mileage?range=${k}`}
              className={
                "text-xs px-3 h-8 inline-flex items-center rounded-full border " +
                (k === range
                  ? "bg-forest-900 text-cream border-forest-900"
                  : "border-forest-200 text-forest-800 hover:border-gold-300")
              }
            >
              {v.label}
            </Link>
          ))}
        </div>

        <div className="mt-6">
          <MileageMap trips={mapTrips} places={places} height={460} />
        </div>

        <h2 className="display text-xl text-forest-900 mt-8">
          By team member
        </h2>
        {byDriver.size === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            No mileage logged by any engaged client&apos;s team in
            this window.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {Array.from(byDriver.entries())
              .sort((a, b) => b[1].deduction - a[1].deduction)
              .map(([id, agg]) => (
                <li
                  key={id}
                  className="card p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-forest-900">
                      {driverLabel.get(id) ?? id.slice(0, 8)}
                    </div>
                    <div className="text-xs text-ink-muted mt-0.5">
                      {agg.trips} trip{agg.trips === 1 ? "" : "s"} ·{" "}
                      {mi(agg.miles)} business mi
                    </div>
                  </div>
                  <div className="display text-lg text-forest-900 tabular-nums">
                    {usd(agg.deduction)}
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>
    </main>
  );
}
