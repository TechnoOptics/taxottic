import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { ClassifyDeck } from "@/components/mileage/ClassifyDeck";
import { businessMileageDeductionCents } from "@/lib/mileage/deduction";
import { classifyTrip } from "./actions";

export type PendingTrip = {
  id: string;
  startedAtISO: string;
  endedAtISO: string;
  distanceMiles: number;
  estDeductionCents: number;
};

export default async function ClassifyPage() {
  const { admin, user } = await requireUserWithAdmin();

  // Pull every unclassified trip the user owns across companies they
  // belong to. The /api/watch/confirm flow uses driver_user_id as the
  // primary auth gate; we mirror that here.
  const { data } = await admin
    .from("mileage_trips")
    .select("id, started_at, ended_at, distance_miles, tax_year")
    .eq("driver_user_id", user.id)
    .eq("classification", "unclassified")
    .order("started_at", { ascending: false })
    .limit(20);

  const pending: PendingTrip[] = (data ?? []).map((row: unknown) => {
    const r = row as {
      id: string;
      started_at: string;
      ended_at: string;
      distance_miles: number;
      tax_year: number;
    };
    const miles = Number(r.distance_miles || 0);
    return {
      id: r.id,
      startedAtISO: r.started_at,
      endedAtISO: r.ended_at,
      distanceMiles: miles,
      estDeductionCents: businessMileageDeductionCents(miles, r.tax_year),
    };
  });

  // Nothing to do — bounce back to Mileage so the user sees the
  // map / breadcrumbs instead of a stranded empty page.
  if (pending.length === 0) {
    redirect("/mileage?caughtup=1");
  }

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-md mx-auto px-4 sm:px-6 py-8">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Mileage · review
        </div>
        <h1 className="display mt-2 text-2xl text-forest-900">
          {pending.length === 1
            ? "One drive needs a quick call."
            : `${pending.length} drives need a quick call.`}
        </h1>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed">
          Tap <strong>Business</strong> if the drive was for work — it
          counts toward your Schedule C mileage deduction. Tap{" "}
          <strong>Personal</strong> if it&apos;s a regular errand. Same
          calls the watch surface for the swipe deck, just bigger.
        </p>

        <ClassifyDeck pending={pending} action={classifyTrip} />

        <div className="mt-8 text-center">
          <Link
            href="/mileage"
            className="text-xs text-ink-muted hover:text-forest-900 underline underline-offset-2"
          >
            Back to mileage
          </Link>
        </div>
      </section>
    </main>
  );
}
