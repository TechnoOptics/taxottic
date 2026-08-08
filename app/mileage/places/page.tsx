import Link from "next/link";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { AddPlaceForm } from "@/components/mileage/AddPlaceForm";
import { DeletePlaceButton } from "@/components/mileage/DeletePlaceButton";
import { addMileagePlace, deleteMileagePlace } from "./actions";

const KIND_LABEL: Record<string, { name: string; rule: string }> = {
  office: {
    name: "Office",
    rule: "Drives here auto-classify as business",
  },
  client: {
    name: "Client site",
    rule: "Drives here auto-classify as business",
  },
  home: {
    name: "Home",
    rule: "Home → home trips classify as personal",
  },
  other: {
    name: "Other",
    rule: "Saved, no auto-classification",
  },
};

export default async function MileagePlacesPage() {
  const { admin, user } = await requireUserWithAdmin();
  const companies = await getMyCompanies();
  const companyId = companies[0]?.company.id;

  let places: Array<{
    id: string;
    kind: string;
    label: string;
    lat: number;
    lng: number;
    radius_m: number;
    created_at: string;
  }> = [];
  if (companyId) {
    const { data } = await admin
      .from("mileage_places")
      .select("id, kind, label, lat, lng, radius_m, created_at")
      .eq("company_id", companyId)
      .order("kind", { ascending: true })
      .order("created_at", { ascending: false });
    places = (data ?? []) as typeof places;
  }

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/mileage"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Mileage
          </Link>{" "}
          · Saved places
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Save your work places, drives there deduct themselves
        </h1>
        <p className="mt-3 max-w-xl text-sm text-ink-soft leading-relaxed">
          Add the offices, client sites, and other work locations you drive
          to. The next time the tracker logs a trip that starts or ends
          within the geofence, Taxottic classifies it as a{" "}
          <span className="font-semibold text-forest-900">business</span>{" "}
          drive automatically and rolls the IRS mileage rate straight into
          your Schedule C deduction. Walks and short hops don&apos;t trigger
, only real drives (≥ 200 m, ≥ ~18 mph segments).
        </p>

        {/* Without a company there is nothing to attach a place to, and
            addMileagePlace refuses every submission for that reason. The
            form used to render anyway, fully interactive: you searched an
            address, set a radius, pressed Save, and only then were told
            to set up a company. Ask for the company first instead. */}
        {!companyId ? (
          <div className="card mt-8 p-6 sm:p-7">
            <h2 className="display text-xl text-forest-900">
              Set up your business first
            </h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              Saved places belong to a business, so there is nowhere to put
              one yet. It takes a name and a minute, and your drives start
              classifying themselves straight after.
            </p>
            <Link href="/onboarding/new-company" className="btn-primary mt-4">
              Set up my business
            </Link>
          </div>
        ) : (
          <div className="card mt-8 p-6 sm:p-7">
            <h2 className="display text-xl text-forest-900">Add a place</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Office, client site, or home, pick the category that matches.
            </p>
            <div className="mt-5">
              <AddPlaceForm addPlaceAction={addMileagePlace} />
            </div>
          </div>
        )}

        {companyId ? (
        <div className="card mt-6 p-6 sm:p-7">
          <h2 className="display text-xl text-forest-900">Your places</h2>
          {places.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              No saved places yet. Add one above and your next trip there
              will classify itself.
            </p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {places.map((p) => {
                const meta = KIND_LABEL[p.kind] ?? KIND_LABEL.other;
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-forest-100 bg-white px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-forest-900 truncate">
                          {p.label}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.16em] text-gold-700 font-semibold">
                          {meta.name}
                        </span>
                      </div>
                      <div className="text-[11px] text-ink-muted mt-0.5">
                        {meta.rule} · {p.radius_m} m radius ·{" "}
                        {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                      </div>
                    </div>
                    <DeletePlaceButton
                      placeId={p.id}
                      label={p.label}
                      action={deleteMileagePlace}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        ) : null}

        <p className="mt-6 text-[11px] leading-relaxed text-ink-muted">
          How it works: the phone tracker streams GPS points only when
          you&apos;re actually moving (filtered at 25 m steps, then segmented
          when you stop for 5+ minutes). On every trip end the server
          checks whether the start or end sits inside one of your saved
          places and writes the classification. You can always override it
          on the trip list.
        </p>
      </section>
    </main>
  );
}
