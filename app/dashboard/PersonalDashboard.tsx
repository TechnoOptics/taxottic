import Link from "next/link";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { AppHeader } from "@/components/AppHeader";
import { TrialBanner } from "@/components/TrialBanner";
import { getTrialState } from "@/lib/plans/usage";
import { buildGreeting } from "@/lib/dashboard/greeting";
import {
  computePersonalReadiness,
} from "@/lib/dashboard/personal-readiness";
import { forecast, formatCents, type ForecastResult } from "@/lib/tax/forecast";
import { buildPersonalForecastInput } from "@/lib/tax/personal-forecast-input";

/**
 * The PERSONAL dashboard — what an individual (W-2 / personal) filer
 * sees at /dashboard. Fully independent of the business side: personal
 * readiness, the user's own 1040 snapshot, personal goals, and the
 * personal playbook. Zero company data on this surface.
 *
 * Business owners keep the owner hub in app/dashboard/page.tsx; this
 * component renders instead of the old redirect("/personal/forecast")
 * so individual filers get a real home, not a bounce.
 */
export async function PersonalDashboard({
  admin,
  supabase,
  user,
  fullName,
}: {
  admin: SupabaseClient;
  supabase: SupabaseClient;
  user: User;
  fullName: string | null;
}) {
  const taxYear = new Date().getUTCFullYear();
  const nowIso = new Date().toISOString();

  const [
    { data: taxProfile },
    { data: personalExpenseRows },
    { data: personalGoals },
    { data: upcomingReminders },
    trial,
  ] = await Promise.all([
    admin
      .from("tax_profiles")
      .select("*")
      .eq("user_id", user.id)
      .eq("tax_year", taxYear)
      .maybeSingle(),
    admin
      .from("personal_expenses")
      .select("category, amount_cents")
      .eq("user_id", user.id)
      .eq("tax_year", taxYear),
    admin
      .from("goals")
      .select("id, title, target_cents, saved_cents, deadline")
      .eq("user_id", user.id)
      .is("company_id", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(3),
    admin
      .from("reminders")
      .select("id, title, due_at")
      .eq("user_id", user.id)
      .is("dismissed_at", null)
      .gte("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(1),
    getTrialState(supabase, user.id),
  ]);

  const readiness = computePersonalReadiness({
    profile: taxProfile as Record<string, unknown> | null,
    personalExpenseCount: (personalExpenseRows ?? []).length,
    personalGoalCount: (personalGoals ?? []).length,
  });

  const personalForecast: ForecastResult | null = taxProfile
    ? forecast(
        buildPersonalForecastInput(
          taxProfile,
          personalExpenseRows ?? [],
          taxYear,
        ),
      )
    : null;

  const nextReminder = (upcomingReminders ?? [])[0] ?? null;
  const nextDeadlineDays = nextReminder
    ? Math.max(
        0,
        Math.ceil(
          (new Date(nextReminder.due_at).getTime() - Date.now()) / 86_400_000,
        ),
      )
    : null;

  const greeting = buildGreeting({ fullName, email: user.email });
  const goals = personalGoals ?? [];
  const todo = readiness.checks.filter((c) => !c.done);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-8 sm:py-12">
        <header>
          <div className="kicker-sm">Personal · Tax year {taxYear}</div>
          <h1 className="display mt-3 text-4xl sm:text-5xl text-forest-900 leading-[1.05]">
            {greeting.head}
          </h1>
          <p className="mt-3 text-base text-ink-soft max-w-xl leading-relaxed">
            {greeting.pleasantry}
          </p>
        </header>

        <TrialBanner trial={trial} />

        {/* Hero stat band: personal readiness, personal 1040, next
            deadline. Same glanceable shape as the owner hub, but every
            number here is the individual's own. */}
        <section className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="surface col-span-2 p-5 flex items-center gap-4">
            <PersonalRing score={readiness.score} />
            <div className="min-w-0">
              <div className="kicker-sm">Tax readiness</div>
              <div className="display text-2xl text-forest-900 mt-0.5">
                {readiness.score >= 100
                  ? "Fully ready"
                  : readiness.score >= 70
                    ? "On track"
                    : readiness.score >= 40
                      ? "Getting there"
                      : "Just starting"}
              </div>
              <div className="text-[13px] text-ink-muted mt-0.5">
                Your personal return
              </div>
            </div>
          </div>

          <Link
            href="/personal/forecast"
            className="surface surface-hover col-span-1 p-5 flex flex-col justify-center min-w-0"
          >
            <div className="kicker-sm">Your 1040</div>
            {personalForecast ? (
              <>
                <div className="display text-xl sm:text-2xl text-forest-900 mt-1 tabular-nums">
                  {personalForecast.refundCents > 0
                    ? `${formatCents(personalForecast.refundCents)} back`
                    : `${formatCents(personalForecast.stillOwedCents)} owed`}
                </div>
                <div className="text-[13px] text-ink-muted mt-0.5 truncate">
                  {formatCents(personalForecast.totalTaxCents)} total tax
                </div>
              </>
            ) : (
              <>
                <div className="display text-xl text-forest-900 mt-1">
                  Set up &rarr;
                </div>
                <div className="text-[13px] text-ink-muted mt-0.5 truncate">
                  Add your tax profile
                </div>
              </>
            )}
          </Link>

          <Link
            href="/reminders"
            className="surface surface-hover col-span-1 p-5 flex flex-col justify-center min-w-0"
          >
            <div className="kicker-sm">Next deadline</div>
            <div className="display text-xl sm:text-2xl text-forest-900 mt-1">
              {nextDeadlineDays === null
                ? "-"
                : nextDeadlineDays === 0
                  ? "Today"
                  : `${nextDeadlineDays} days`}
            </div>
            <div className="text-[13px] text-ink-muted mt-0.5 truncate">
              {nextReminder ? nextReminder.title : "Nothing scheduled"}
            </div>
          </Link>
        </section>

        {/* Readiness checklist: every unmet check is a link that fixes
            it. Actionable, not a bare score. */}
        {todo.length > 0 ? (
          <section className="mt-10">
            <div className="kicker-sm">Get tax-ready</div>
            <ul className="mt-3 grid gap-2">
              {todo.map((c) => (
                <li key={c.key}>
                  <Link
                    href={c.href}
                    className="surface surface-hover p-4 flex items-center gap-3"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full shrink-0 bg-gold-400"
                    />
                    <span className="min-w-0 flex-1 text-sm text-forest-900">
                      {c.label}
                    </span>
                    <span className="text-ink-muted shrink-0">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Playbook CTA — the personal savings moves. */}
        <section className="mt-10">
          <Link
            href="/personal/playbook"
            className="card card-hover p-6 flex items-start gap-3 border-gold-300/60 block"
          >
            <div className="min-w-0">
              <div className="kicker-sm">Savings playbook</div>
              <div className="display mt-1 text-xl text-forest-900">
                The moves still worth making this year
              </div>
              <p className="mt-1 text-sm text-ink-soft leading-relaxed">
                IRA and HSA room, credits, harvesting — personalized,
                IRS-cited, each with the dollars it saves at your bracket.
              </p>
            </div>
            <span className="ml-auto text-ink-muted shrink-0">→</span>
          </Link>
        </section>

        {/* Personal goals (adopted playbook moves). */}
        {goals.length > 0 ? (
          <section className="mt-10">
            <div className="flex items-baseline justify-between">
              <div className="kicker-sm">Your goals</div>
              <Link
                href="/goals"
                className="text-xs text-forest-700 hover:text-forest-900 underline underline-offset-2"
              >
                All goals →
              </Link>
            </div>
            <ul className="mt-3 grid gap-2">
              {goals.map((g) => {
                const pct =
                  g.target_cents > 0
                    ? Math.min(
                        100,
                        Math.round((g.saved_cents / g.target_cents) * 100),
                      )
                    : 0;
                return (
                  <li key={g.id} className="surface p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-forest-900 font-medium">
                        {g.title}
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted tabular-nums">
                        {formatCents(g.saved_cents)} /{" "}
                        {formatCents(g.target_cents)}
                      </span>
                    </div>
                    <div className="mt-2 rounded-full bg-forest-50 overflow-hidden h-1.5">
                      <span
                        className="block h-full bg-gold-400"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <p className="mt-12 text-[11px] text-ink-muted leading-relaxed max-w-2xl">
          This is your personal tax home — nothing here reads from any
          business. Running a business too? Switch to the Business side
          from the menu.
        </p>
      </section>
    </main>
  );
}

/** Gold progress ring, personal edition (the owner hub retired its
 *  business ring; this one meters the user's OWN readiness). */
function PersonalRing({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  const r = 26;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  return (
    <svg
      width="60"
      height="60"
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(213,187,126,0.18)" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="#c4a25d"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 32 32)"
      />
      <text
        x="32"
        y="37"
        textAnchor="middle"
        fill="currentColor"
        className="display text-forest-900"
        style={{ fontSize: "15px" }}
      >
        {pct}
      </text>
    </svg>
  );
}
