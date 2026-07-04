import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { ScheduleForm } from "@/components/mileage/ScheduleForm";
import { setMileageSchedule } from "./actions";
import type { MileageSchedule } from "@/lib/mileage/schedule";
import { summarise } from "@/lib/mileage/schedule";

type Search = { saved?: string };

export default async function MileageSchedulePage(props: {
  searchParams: Promise<Search>;
}) {
  const { supabase, user } = await requireUser();
  const sp = await props.searchParams;

  const { data: profile } = await supabase
    .from("profiles")
    .select("mileage_schedule")
    .eq("id", user.id)
    .maybeSingle();

  // Treat null + unset the same as "always on" so the form renders
  // a sensible default. The saved column is null only until the
  // user explicitly chooses on this page.
  const schedule: MileageSchedule | null =
    (profile?.mileage_schedule as MileageSchedule | null) ?? null;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Mileage
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          When should I log drives?
        </h1>
        <p className="mt-2 text-sm text-ink-soft max-w-2xl">
          Configure when the auto-mileage tracker is allowed to run.
          Outside the window, your phone won&apos;t use Location even
          if the toggle is on, so your battery + privacy match your
          actual workdays.
        </p>

        {sp.saved === "1" ? (
          <div
            role="status"
            className="mt-4 card p-3 text-sm border-green-200 bg-green-50/40 text-forest-900"
          >
            Saved. Your tracker is now {summarise(schedule).toLowerCase()}.
          </div>
        ) : null}

        <div className="card mt-6 p-6 sm:p-7">
          <ScheduleForm
            initial={schedule}
            action={setMileageSchedule}
          />
        </div>

        <div className="mt-6 text-xs text-ink-muted">
          <Link
            href="/mileage"
            className="underline underline-offset-2 hover:text-forest-900"
          >
            Back to mileage
          </Link>
        </div>
      </section>
    </main>
  );
}
