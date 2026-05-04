import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { CompanyLogo } from "@/components/CompanyLogo";
import { evaluateBadges } from "@/lib/badges/evaluate";
import { AchievementsGrid } from "@/components/AchievementsGrid";
import { MedalCelebration } from "@/components/MedalCelebration";
import { WelcomeTour } from "@/components/WelcomeTour";
import { ensureQuarterlyReminders } from "@/lib/reminders/seed";
import { formatCents } from "@/lib/tax/forecast";
import { buildGreeting } from "@/lib/dashboard/greeting";
import { computeReadiness, type Readiness } from "@/lib/dashboard/readiness";
import { checkCompanyLimit } from "@/lib/plans/usage";
import { completeWelcomeTour } from "@/app/actions/tour";
import { GoalDismissButton } from "@/components/GoalDismissButton";

export default async function DashboardPage() {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const taxYear = new Date().getUTCFullYear();

  // Invited employees: if they joined a company they didn't create and
  // haven't been onboarded yet, route them to a quick "tell us your role"
  // welcome before the regular dashboard. Managers (or already onboarded
  // members) skip this.
  const { data: pendingOnboarding } = await admin
    .from("company_members")
    .select("company_id, role, joined_at")
    .eq("user_id", user.id)
    .eq("role", "member")
    .is("onboarded_at", null)
    .order("joined_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingOnboarding?.company_id) {
    redirect(
      `/onboarding/employee-role?company_id=${pendingOnboarding.company_id}`,
    );
  }

  // Lazy-evaluate badges + ensure reminders exist on every dashboard hit.
  // Both are idempotent and use admin client so the inserts work regardless
  // of cookie auth quirks. Reads filter explicitly by user_id so they remain
  // scoped correctly even with admin privileges.
  // evaluateBadges returns the codes that were JUST awarded (empty
  // on subsequent renders thanks to the unique constraint), so we
  // can pop a celebration overlay one-shot without any client
  // session-storage trickery.
  const [newlyEarnedCodes] = await Promise.all([
    evaluateBadges(admin, user.id),
    ensureQuarterlyReminders(admin, user.id, taxYear),
  ]);

  const companies = await getMyCompanies();

  // Plan-aware "+ New company" gating. Free is capped at 1 company;
  // when at the cap we show the link greyed out with an upgrade
  // tooltip so the user learns about Pro instead of bouncing off a
  // crash on submission.
  const companyLimit = await checkCompanyLimit(supabase, user.id);
  const canCreateCompany = companyLimit.ok;
  const newCompanyTooltip = canCreateCompany
    ? undefined
    : "Free plan supports 1 company. Upgrade to Pro for unlimited.";

  // Personalized greeting (full name from profile, falls back to email handle).
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, tour_completed_at")
    .eq("id", user.id)
    .maybeSingle();
  const greeting = buildGreeting({
    fullName: profile?.full_name,
    email: user.email,
  });
  const showWelcomeTour = !profile?.tour_completed_at;
  const tourDisplayName =
    profile?.full_name?.split(/\s+/)[0]?.trim() ||
    user.email?.split("@")[0]?.split(/[._-]/)[0] ||
    null;

  if (companies.length === 0) {
    const { data: pending } = await supabase
      .from("invitations")
      .select("id, company_id, role, company:companies(name, public_id)")
      .is("accepted_at", null);

    return (
      <main className="min-h-screen">
        <AppHeader email={user.email ?? undefined} />
        <section className="max-w-2xl mx-auto px-6 py-16">
          <div className="card p-10 text-center">
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              Welcome
            </div>
            <h1 className="display mt-3 text-4xl text-forest-900">
              Let&apos;s set up your first company.
            </h1>
            <p className="mt-3 text-sm text-ink-soft">
              You&apos;re signed in as {user.email}.
            </p>

            {pending && pending.length > 0 ? (
              <div className="mt-8 text-left">
                <h2 className="text-sm font-medium text-forest-800">
                  Pending invitations
                </h2>
                <ul className="mt-3 grid gap-2">
                  {pending.map((p) => (
                    <li
                      key={p.id}
                      className="rounded-lg border border-forest-100 bg-white px-3 py-2 text-sm flex justify-between"
                    >
                      <span className="text-forest-800">
                        {(p.company as unknown as { name: string }).name}
                      </span>
                      <span className="text-ink-muted">{p.role}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-8">
              <Link href="/onboarding/new-company" className="btn-primary">
                Create a new company
              </Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // Pull dashboard data: upcoming + overdue reminders + active goals + badges
  // + per-company tax-readiness scores so the company cards can render a
  // small progress bar without a second round-trip.
  const nowIso = new Date().toISOString();
  const [
    { data: upcomingReminders },
    { data: overdueReminders },
    { data: activeGoals },
    { data: badges },
    readinessByCompany,
  ] = await Promise.all([
    supabase
      .from("reminders")
      .select("id, kind, title, due_at")
      .is("dismissed_at", null)
      .gte("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(3),
    supabase
      .from("reminders")
      .select("id, kind, title, due_at")
      .is("dismissed_at", null)
      .lt("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(3),
    supabase
      .from("goals")
      .select("id, title, target_cents, saved_cents, status, deadline")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("badges")
      .select("badge_code, awarded_at")
      .eq("user_id", user.id)
      .order("awarded_at", { ascending: false }),
    Promise.all(
      companies.map(async (m) => {
        const r = await computeReadiness(admin, m.company_id, taxYear);
        return [m.company_id, r] as const;
      }),
    ).then((entries) => new Map<string, Readiness>(entries)),
  ]);

  // Recap: figure out what most needs attention this visit.
  const recap: { title: string; body: string; href: string; tone: "warn" | "info" }[] = [];

  if (overdueReminders && overdueReminders.length > 0) {
    recap.push({
      title: `${overdueReminders.length} overdue reminder${overdueReminders.length === 1 ? "" : "s"}`,
      body:
        "These tax-payment dates already passed. Knock them out so they stop nagging.",
      href: "/reminders",
      tone: "warn",
    });
  }

  // Did the user log any expense this month? If not, nudge.
  const monthStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  ).toISOString();
  const { count: thisMonthExpenseCount } = await admin
    .from("monthly_expenses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", monthStart);
  if ((thisMonthExpenseCount ?? 0) === 0 && companies.length > 0) {
    recap.push({
      title: "No expenses logged this month",
      body:
        "Log even one and your forecast tightens. The first company can do it now.",
      href: `/c/${companies[0].company.public_id}/expenses`,
      tone: "info",
    });
  }

  // Tax-preparer engagement nudges. Surfaced on the dashboard so a
  // client doesn't have to drill into a company to discover that a
  // firm has invited them to engage, or that they have a request
  // sitting unanswered. Both directions handled.
  if (companies.length > 0) {
    const companyIds = companies.map((m) => m.company_id);
    const { data: engagementNudges } = await admin
      .from("firm_engagements")
      .select(
        "id, status, tax_year, kind, company_id, firm:firms(name, public_id)",
      )
      .in("company_id", companyIds)
      .in("status", ["pending_client", "pending_firm"]);

    type FirmRow = { name: string; public_id: string };
    type EngRow = {
      id: string;
      status: string;
      tax_year: number;
      kind: string;
      company_id: string;
      firm: FirmRow | FirmRow[] | null;
    };
    const compById = new Map(
      companies.map((m) => [m.company_id, m.company.public_id]),
    );
    const awaitingMine = ((engagementNudges ?? []) as unknown as EngRow[]).filter(
      (e) => e.status === "pending_client",
    );
    const awaitingFirm = ((engagementNudges ?? []) as unknown as EngRow[]).filter(
      (e) => e.status === "pending_firm",
    );

    for (const e of awaitingMine) {
      const firm = (Array.isArray(e.firm) ? e.firm[0] : e.firm) as FirmRow | null;
      const compPub = compById.get(e.company_id);
      if (!compPub) continue;
      recap.push({
        title: `${firm?.name ?? "A tax preparer"} wants to engage you`,
        body: `Tax year ${e.tax_year} · review and accept or decline.`,
        href: `/c/${compPub}/preparer`,
        tone: "warn",
      });
    }
    if (awaitingFirm.length > 0) {
      const firstComp = compById.get(awaitingFirm[0].company_id);
      if (firstComp) {
        recap.push({
          title: `${awaitingFirm.length} preparer request${awaitingFirm.length === 1 ? "" : "s"} sent, awaiting acceptance`,
          body:
            "The firm hasn't responded yet. You'll get a heads-up here when they do.",
          href: `/c/${firstComp}/preparer`,
          tone: "info",
        });
      }
    }
  }

  // Goals progress nudge: if any active goal is < 25% with deadline approaching
  if (activeGoals && activeGoals.length > 0) {
    const lagging = activeGoals.find(
      (g) =>
        g.target_cents > 0 &&
        g.saved_cents / g.target_cents < 0.25 &&
        g.deadline &&
        new Date(g.deadline).getTime() - Date.now() < 60 * 86_400_000,
    );
    if (lagging) {
      recap.push({
        title: `Goal "${lagging.title}" is behind pace`,
        body: "Fewer than two months to the deadline. A small contribution moves the needle.",
        href: "/goals",
        tone: "info",
      });
    }
  }

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Your workspace
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
          {greeting.head}
        </h1>
        <p className="mt-2 text-sm sm:text-base text-ink-soft">
          {greeting.pleasantry}
        </p>

        {/* Recap: what needs attention right now */}
        {recap.length > 0 ? (
          <section className="mt-6 grid gap-3">
            {recap.map((r, i) => (
              <Link
                key={i}
                href={r.href}
                className={
                  "card p-4 flex items-start gap-3 hover:border-gold-300 transition-colors " +
                  (r.tone === "warn" ? "border-red-200" : "")
                }
              >
                <div
                  className={
                    "mt-1 size-2 rounded-full shrink-0 " +
                    (r.tone === "warn" ? "bg-red-500" : "bg-gold-400")
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="display text-base text-forest-900">
                    {r.title}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                    {r.body}
                  </div>
                </div>
                <span className="text-ink-muted text-sm">→</span>
              </Link>
            ))}
          </section>
        ) : null}

        {/* Upcoming reminders */}
        {upcomingReminders && upcomingReminders.length > 0 ? (
          <section className="mt-8">
            <div className="flex items-end justify-between">
              <h2 className="display text-xl text-forest-900">Coming up</h2>
              <Link
                href="/reminders"
                className="text-sm text-ink-soft hover:text-forest-800"
              >
                All reminders &rarr;
              </Link>
            </div>
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {upcomingReminders.map((r) => {
                const days = Math.max(
                  0,
                  Math.ceil(
                    (new Date(r.due_at).getTime() - Date.now()) / 86_400_000,
                  ),
                );
                return (
                  <li
                    key={r.id}
                    className="card p-4"
                  >
                    <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
                      In {days} day{days === 1 ? "" : "s"}
                    </div>
                    <div className="display text-base text-forest-900 mt-1">
                      {r.title}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* Companies */}
        <section className="mt-8">
          <div className="flex items-end justify-between">
            <h2 className="display text-xl text-forest-900">Companies</h2>
            {canCreateCompany ? (
              <Link
                href="/onboarding/new-company"
                className="text-sm text-forest-700 hover:text-forest-900"
              >
                + New company
              </Link>
            ) : (
              <Link
                href="/billing?reason=company_limit"
                className="text-sm text-ink-muted hover:text-forest-900 inline-flex items-center gap-1.5"
                title={newCompanyTooltip}
              >
                <span aria-hidden="true">🔒</span>
                + New company (Pro)
              </Link>
            )}
          </div>
          <ul className="mt-3 grid gap-3">
            {companies.map((m) => {
              const isManager = m.role === "manager";
              const r = readinessByCompany.get(m.company_id);
              const score = r?.score ?? 0;
              // Compact breakdown shown next to the bar; the full per-metric
              // story sits in the title attr for hover.
              const breakdown = r?.hasBankFeed
                ? `${r.triagedTx}/${r.totalTx} tx · ${r.categoriesUsed}/${r.targetCategories} cats`
                : r
                  ? `${r.categoriesUsed}/${r.targetCategories} categories`
                  : "—";
              const tooltip = r?.hasBankFeed
                ? `${r.triagedTx} of ${r.totalTx} bank transactions triaged in the last 90 days, and ${r.categoriesUsed} of ${r.targetCategories} starter deduction categories claimed this tax year.`
                : r
                  ? `${r.categoriesUsed} of ${r.targetCategories} starter deduction categories claimed this tax year. Connect a bank to add expensing-engagement to this score.`
                  : "Tax readiness — start logging expenses to see this fill in.";
              return (
                <li
                  key={m.company_id}
                  className="card card-hover p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <CompanyLogo
                      src={m.company.logo_url}
                      name={m.company.name}
                      size={48}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="display text-xl text-forest-900 truncate">
                        {m.company.name}
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5 tracking-wide">
                        {m.company.public_id}
                        <span className="text-gold-500"> · </span>
                        {isManager ? "Manager" : "Member"}
                      </div>
                      <div className="mt-3 max-w-sm" title={tooltip}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
                            Tax-ready · {score}%
                          </span>
                          <span className="text-[11px] text-ink-muted">
                            {breakdown}
                          </span>
                        </div>
                        <div
                          className="mt-1 h-1.5 rounded-full bg-forest-50 overflow-hidden"
                          role="progressbar"
                          aria-valuenow={score}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`Tax readiness for ${m.company.name}`}
                        >
                          <div
                            className="h-full bg-gold-400 transition-[width] duration-500"
                            style={{ width: `${score}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/c/${m.company.public_id}/forecast`}
                      className="btn-primary text-sm"
                    >
                      Open
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Active goals */}
        {activeGoals && activeGoals.length > 0 ? (
          <section className="mt-8">
            <div className="flex items-end justify-between">
              <h2 className="display text-xl text-forest-900">Active goals</h2>
              <Link
                href="/goals"
                className="text-sm text-ink-soft hover:text-forest-800"
              >
                All goals &rarr;
              </Link>
            </div>
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {activeGoals.map((g) => {
                const pct =
                  g.target_cents > 0
                    ? Math.min(
                        100,
                        Math.round((g.saved_cents / g.target_cents) * 100),
                      )
                    : 0;
                return (
                  <li key={g.id} className="card p-4 relative">
                    <div className="absolute top-2 right-2">
                      <GoalDismissButton goalId={g.id} goalTitle={g.title} />
                    </div>
                    <div className="display text-base text-forest-900 truncate pr-6">
                      {g.title}
                    </div>
                    <div className="text-xs text-ink-muted mt-1">
                      {formatCents(g.saved_cents)} of{" "}
                      {formatCents(g.target_cents)}
                    </div>
                    <div className="mt-3 h-1.5 rounded-full bg-forest-50 overflow-hidden">
                      <div
                        className="h-full bg-gold-400"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <section className="mt-8">
            <div className="card p-5 flex items-center justify-between gap-4">
              <div>
                <div className="display text-base text-forest-900">
                  Set a goal to stay ahead.
                </div>
                <p className="text-xs text-ink-muted mt-1">
                  Pick a tax-savings target and watch the gap close.
                </p>
              </div>
              <Link href="/goals" className="btn-ghost">
                New goal
              </Link>
            </div>
          </section>
        )}

        {/* Achievements: each medal sits in a thick metal frame; earned ones
            get an animated holographic shimmer wave. */}
        <section className="mt-8">
          <div className="flex items-end justify-between">
            <h2 className="display text-xl text-forest-900">
              Your achievements
            </h2>
            <span className="text-xs text-ink-muted">
              {badges?.length ?? 0} earned
            </span>
          </div>
          <AchievementsGrid
            earnedCodes={(badges ?? []).map((b) => b.badge_code)}
          />
        </section>
      </section>

      {/* First-run welcome tour. Shows once per profile; the action
          flips tour_completed_at so it never returns. */}
      <WelcomeTour
        show={showWelcomeTour}
        completeAction={completeWelcomeTour}
        displayName={tourDisplayName}
      />

      {/* Celebrate any badges that were just awarded on this render. */}
      <MedalCelebration newlyEarnedCodes={newlyEarnedCodes} />
    </main>
  );
}
