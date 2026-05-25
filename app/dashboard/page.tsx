import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { CompanyLogo } from "@/components/CompanyLogo";
import { evaluateBadges } from "@/lib/badges/evaluate";
import { AchievementsGrid } from "@/components/AchievementsGrid";
import { TrialBanner } from "@/components/TrialBanner";
import { getTrialState } from "@/lib/plans/usage";
import { runTrialGuard } from "@/lib/security/trial-guard";
import { MedalCelebration } from "@/components/MedalCelebration";
import { WelcomeTour } from "@/components/WelcomeTour";
import { ensureQuarterlyReminders } from "@/lib/reminders/seed";
import { formatCents } from "@/lib/tax/forecast";
import { buildGreeting } from "@/lib/dashboard/greeting";
import { computeReadiness, type Readiness } from "@/lib/dashboard/readiness";
import { checkCompanyLimit } from "@/lib/plans/usage";
import { completeWelcomeTour } from "@/app/actions/tour";
import { GoalDismissButton } from "@/components/GoalDismissButton";
import { purgeExpiredRecycleBin } from "@/app/actions/recycle-bin";
import { dismissAllOverdueReminders } from "@/app/reminders/actions";
import { ReadinessHelp } from "@/components/ReadinessHelp";

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

  // Fan out the independent top-of-dashboard queries in one round-trip.
  // Previously each of these awaited serially: evaluateBadges →
  // ensureQuarterlyReminders → getMyCompanies → checkCompanyLimit →
  // profile lookup. That stacked 5 Supabase roundtrips (~50-200ms each)
  // before the first paint, which compounded with Vercel cold starts to
  // make dashboard clicks feel sluggish. Promise.all collapses them
  // into one parallel batch since none of them depend on each other's
  // result. The redirect checks happen after — once everything has
  // landed.
  // evaluateBadges returns the codes that were JUST awarded (empty
  // on subsequent renders thanks to the unique constraint), so we
  // can pop a celebration overlay one-shot without any client
  // session-storage trickery.
  const [
    newlyEarnedCodes,
    ,
    companies,
    companyLimit,
    profileResult,
  ] = await Promise.all([
    evaluateBadges(admin, user.id),
    ensureQuarterlyReminders(admin, user.id, taxYear),
    getMyCompanies(),
    checkCompanyLimit(supabase, user.id),
    admin
      .from("profiles")
      .select(
        "full_name, tour_completed_at, tax_filer_type, tax_disclaimer_accepted_at",
      )
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const profile = profileResult.data;

  // Legal disclaimer gate — the very first onboarding step. Before a
  // new user picks W-2 vs business (or a w2 user is bounced to the
  // personal forecast) they must acknowledge that Taxottic produces
  // forecasts/estimates, not a filed return. One-shot: cleared once
  // tax_disclaimer_accepted_at is set. Placed before the filer-type
  // fork so it precedes every downstream redirect.
  if (profile && !profile.tax_disclaimer_accepted_at) {
    redirect("/onboarding/disclaimer");
  }

  // Plan-aware "+ New company" gating. Free is capped at 1 company;
  // when at the cap we show the link greyed out with an upgrade
  // tooltip so the user learns about Pro instead of bouncing off a
  // crash on submission.
  const canCreateCompany = companyLimit.ok;
  const newCompanyTooltip = canCreateCompany
    ? undefined
    : "Free plan supports 1 company. Upgrade to Pro for unlimited.";

  // Personalized greeting + filer-type fork. New signups land on the
  // dashboard before they've picked W-2 vs business; route them to
  // /onboarding/filer-type. W-2 users get sent to the personal-mode
  // forecast since the company-centric dashboard wouldn't show them
  // anything useful.
  if (profile && !profile.tax_filer_type) {
    redirect("/onboarding/filer-type");
  }
  if (profile?.tax_filer_type === "w2") {
    redirect("/personal/forecast");
  }
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
    // Check three things to render the right empty state:
    //   - super-admin status (so we don't push contact@taxottic.com
    //     into a personal onboarding loop when they're really there
    //     to do operator work)
    //   - pending invitations (so an accountant invited to a firm
    //     sees them right away)
    //   - companies in the user's recycle bin (so a user who said
    //     "I already have one" can see they just put it in the bin)
    const [{ data: pending }, { data: isSuperAdminFlag }, { data: bin }] =
      await Promise.all([
        supabase
          .from("invitations")
          .select("id, company_id, role, company:companies(name, public_id)")
          .is("accepted_at", null),
        supabase.rpc("is_super_admin"),
        admin
          .from("companies")
          .select("id, public_id, name, deleted_at")
          .eq("created_by", user.id)
          .not("deleted_at", "is", null)
          .order("deleted_at", { ascending: false }),
      ]);
    const isSuperAdmin = Boolean(isSuperAdminFlag);
    const recycledCompanies = (bin ?? []) as Array<{
      id: string;
      public_id: string;
      name: string;
      deleted_at: string;
    }>;

    return (
      <main id="main" className="min-h-screen">
        <AppHeader email={user.email ?? undefined} />
        <section className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
          <div className="card p-6 sm:p-10 text-center">
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              {isSuperAdmin ? "Operator view" : "Welcome"}
            </div>
            <h1 className="display mt-3 text-4xl text-forest-900">
              {isSuperAdmin
                ? "You're signed in as a super-admin."
                : "Let's set up your first company."}
            </h1>
            <p className="mt-3 text-sm text-ink-soft">
              {isSuperAdmin
                ? `Hi ${user.email}. This is the consumer dashboard. Super-admin work lives in HQ / Enterprise — pick a portal from the profile menu.`
                : `You're signed in as ${user.email}.`}
            </p>

            {/* Recycle-bin notice: if the user closed a company recently
                this is what they see instead of being told to "create
                their first" (when they think they already have one). */}
            {recycledCompanies.length > 0 ? (
              <div className="mt-8 text-left rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <h2 className="text-sm font-medium text-forest-900">
                  You have {recycledCompanies.length}{" "}
                  {recycledCompanies.length === 1 ? "company" : "companies"} in
                  your recycle bin
                </h2>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  {recycledCompanies.length === 1
                    ? `"${recycledCompanies[0].name}"`
                    : recycledCompanies
                        .slice(0, 3)
                        .map((c) => `"${c.name}"`)
                        .join(", ")}
                  {recycledCompanies.length > 3
                    ? ` + ${recycledCompanies.length - 3} more`
                    : ""}
                  . Restore in one click before the 30-day grace window
                  ends.
                </p>
                <Link
                  href="/settings/recycle-bin"
                  className="inline-block mt-3 text-sm text-forest-800 underline hover:text-forest-900"
                >
                  Open recycle bin &rarr;
                </Link>
              </div>
            ) : null}

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

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {isSuperAdmin ? (
                <>
                  {/* Push super-admins toward the right destination
                      instead of nudging them into personal onboarding.
                      The Switch portal menu in the profile dropdown
                      offers the same thing; this is a more obvious
                      second route. */}
                  <Link href="/admin" className="btn-primary">
                    HQ overview
                  </Link>
                  <Link href="/admin/firms" className="btn-ghost">
                    Enterprise / firms
                  </Link>
                  <Link
                    href="/onboarding/new-company"
                    className="text-sm text-ink-soft hover:text-forest-900 underline"
                  >
                    Or set up a personal company anyway
                  </Link>
                </>
              ) : (
                <Link href="/onboarding/new-company" className="btn-primary">
                  Create a new company
                </Link>
              )}
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
  //
  // First-visit suppression: when a user has just created their account
  // (no expenses logged ever, joined a company in the last 7 days), the
  // auto-seeded quarterly reminders show up as "overdue" because Q1 is
  // already in the past on a May sign-up. The May 2026 audit flagged
  // this as P1-7: showing a red-dot "overdue" on day one reads as a
  // failure state when really nothing is wrong yet. We soften the
  // first-visit version: same reminder, gentler copy and `info` tone
  // (gold, not red). Once the user has actually started using the
  // product, we return to the original urgent treatment.
  // `dismissAction` is the server-action ID a small "X" button on the
  // card invokes when the user wants to clear it. Only the overdue-
  // reminders card sets it today — the audit's Low finding was that
  // the banner had no way to be dismissed. Other recap entries are
  // recoverable by the underlying state (logging an expense clears
  // "No expenses logged this month" automatically), so we don't need
  // a manual dismiss for them.
  const recap: {
    title: string;
    body: string;
    href: string;
    tone: "warn" | "info";
    dismissAction?: "overdue-reminders";
  }[] = [];

  const earliestJoin = companies.length
    ? Math.min(...companies.map((m) => new Date(m.joined_at).getTime()))
    : Date.now();
  const accountAgeDays = (Date.now() - earliestJoin) / 86_400_000;
  const isFresh = accountAgeDays < 7;

  // Did the user log any expense this month? Compute up front so the
  // "fresh account" check below can also factor in whether they've
  // actually started using the product at all.
  const monthStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  ).toISOString();
  const { count: thisMonthExpenseCount } = await admin
    .from("monthly_expenses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", monthStart);
  const { count: allTimeExpenseCount } = await admin
    .from("monthly_expenses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  const hasNeverLoggedExpense = (allTimeExpenseCount ?? 0) === 0;
  const treatAsFirstVisit = isFresh && hasNeverLoggedExpense;

  if (overdueReminders && overdueReminders.length > 0) {
    if (treatAsFirstVisit) {
      recap.push({
        title: `${overdueReminders.length} earlier-quarter reminder${overdueReminders.length === 1 ? "" : "s"} on your calendar`,
        body:
          "Welcome — these are the standard quarterly tax dates that fell before today. Open the list to mark off ones you already handled.",
        href: "/reminders",
        tone: "info",
        dismissAction: "overdue-reminders",
      });
    } else {
      recap.push({
        title: `${overdueReminders.length} overdue reminder${overdueReminders.length === 1 ? "" : "s"}`,
        body:
          "These tax-payment dates already passed. Knock them out so they stop nagging.",
        href: "/reminders",
        tone: "warn",
        dismissAction: "overdue-reminders",
      });
    }
  }

  if ((thisMonthExpenseCount ?? 0) === 0 && companies.length > 0) {
    recap.push({
      title: treatAsFirstVisit
        ? "Log your first expense — your forecast comes alive after this"
        : "No expenses logged this month",
      body: treatAsFirstVisit
        ? "Even one expense (or one bank connection) gives the tax-ready meter and forecast something to chew on. You can paste a single transaction or import a CSV."
        : "Log even one and your forecast tightens. The first company can do it now.",
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

  // Platform router: super-admins who have flipped active_platform
  // should land in the right shell. Done here (not at /) so a
  // hard-coded /dashboard link from email/etc still routes correctly.
  //
  // Each non-user platform CAN live on its own subdomain (May 2026
  // three-portal split). When the subdomain is live (env flag), we
  // redirect cross-origin. When it's not, we fall back to the legacy
  // `/admin/**` path on the consumer host so users don't hit
  // DNS_PROBE_FINISHED_NXDOMAIN. Same env-var contract as
  // app/settings/actions.ts:
  //   NEXT_PUBLIC_HQ_HOST_LIVE         (default true)
  //   NEXT_PUBLIC_ENTERPRISE_HOST_LIVE (default false until DNS is wired)
  const { data: pickedPlatform } = await admin
    .from("profiles")
    .select("active_platform")
    .eq("id", user.id)
    .maybeSingle();
  const ap = pickedPlatform?.active_platform as string | null;
  if (ap === "hq" || ap === "enterprise") {
    // Gate the platform-router redirect on super-admin status. Without
    // this gate we ping-pong: /dashboard → hq.taxottic.com/ → /admin →
    // requireSuperAdmin fails for a non-super-admin → redirect back to
    // /dashboard → and around again until the browser gives up with
    // ERR_TOO_MANY_REDIRECTS. Reported during the May 2026 three-
    // portal launch when a freshly-signed-in user's profile carried
    // `active_platform=hq` from earlier internal testing.
    //
    // Defense in depth: read super-admin status with the user-scoped
    // client (NOT admin) so it goes through the same `is_super_admin`
    // SECURITY DEFINER function the routes themselves use.
    const { data: isSuperAdmin } = await supabase.rpc("is_super_admin");
    if (isSuperAdmin) {
      // SAME-ORIGIN ONLY. A cross-origin redirect to
      // hq./enterprise.taxottic.com ejects the Capacitor app to the
      // system browser (the WebView is pinned to taxottic.com), which
      // is exactly the "kicked out to Chrome" bug. The portals are the
      // same codebase under /admin/** — render them here, no
      // cross-origin hop, so the app (and web) stay put. Subdomains
      // still resolve if visited directly on the web.
      redirect(ap === "hq" ? "/admin" : "/admin/firms");
    }
    // Non-super-admin with a stale active_platform: clear it so the
    // platform router stops trying to send them somewhere they can't
    // go, and fall through to the normal consumer dashboard.
    await admin
      .from("profiles")
      .update({ active_platform: null })
      .eq("id", user.id);
  }

  // Trial-fraud guard runs lazily on the FIRST dashboard load — if
  // this device already used a trial under another account, the
  // current user's subscription is flipped to free before we read
  // the trial state below. Subsequent loads short-circuit on
  // profile.trial_validated_at so the cost is bounded to one query
  // per user lifetime.
  await runTrialGuard({ admin, userId: user.id });

  // Lazy recycle-bin sweep: every dashboard render takes a peek at
  // expired soft-deletes and hard-deletes anything past 30 days. The
  // SQL function enforces the cutoff regardless of caller, so this is
  // a safe no-op when there's nothing to purge. Cron is the proper
  // backstop for users who don't sign in often, but having this on
  // every active user's dashboard means the recycle bin stays
  // accurate for everyone who's actually using the product.
  try {
    await purgeExpiredRecycleBin();
  } catch {
    // Non-fatal: dashboard still renders; the cron picks up the slack.
  }
  const trial = await getTrialState(supabase, user.id);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Your workspace
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
          {greeting.head}
        </h1>
        <p className="mt-2 text-sm sm:text-base text-ink-soft">
          {greeting.pleasantry}
        </p>

        <TrialBanner trial={trial} />

        {/* Recap: what needs attention right now.
            Cards that have a `dismissAction` render a small "X" in the
            top-right corner so the user can clear the card in one
            click. We can't nest a <form>+<button> inside the outer
            <Link> (HTML doesn't allow nested interactive elements and
            React warns about it), so the card root is a <div> with a
            sibling overlay Link covering the click target. The X
            button sits above the overlay (z-10) and stops propagation
            so clicking it doesn't also navigate. */}
        {recap.length > 0 ? (
          <section className="mt-6 grid gap-3">
            {recap.map((r, i) => (
              <div
                key={i}
                className={
                  "card relative p-4 flex items-start gap-3 hover:border-gold-300 transition-colors " +
                  (r.tone === "warn" ? "border-red-200" : "")
                }
              >
                <Link
                  href={r.href}
                  aria-label={r.title}
                  className="absolute inset-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                />
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
                {/* "Navigate" arrow at the right edge of the content
                    row. Hide it when the card also has a dismiss (X)
                    button — the X sits absolute top-right and the
                    arrow at the middle-right edge were visually
                    colliding in the same corner. The whole card is
                    still clickable via the overlay <Link> above, so
                    the visual nav hint is redundant when there's
                    already an X. */}
                {r.dismissAction ? null : (
                  <span className="text-ink-muted text-sm shrink-0">→</span>
                )}
                {r.dismissAction === "overdue-reminders" ? (
                  <form
                    action={dismissAllOverdueReminders}
                    className="absolute right-2 top-2 z-10"
                  >
                    <button
                      type="submit"
                      aria-label="Dismiss overdue reminders"
                      title="Dismiss — you can still open them from /reminders"
                      className="rounded-full p-1 text-ink-muted hover:bg-cream-200 hover:text-forest-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 dark:hover:bg-forest-800"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M3 3 L11 11 M11 3 L3 11" />
                      </svg>
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {/* Upcoming reminders. Multi-company users were seeing the
            same quarterly-estimate reminder rendered once per company
            (audit's Low finding: three identical "Q2 estimated tax
            (2026)" rows at "in 33 days"). Dedupe in render by
            (title, due_at) — the user only needs to see the deadline
            once. The deeper /reminders page can still split by company
            if a power user wants the per-company view. */}
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
              {dedupeReminders(upcomingReminders).map((r) => {
                const dueDate = new Date(r.due_at);
                const days = Math.max(
                  0,
                  Math.ceil((dueDate.getTime() - Date.now()) / 86_400_000),
                );
                // Absolute date underneath the relative pill. CPAs (P3 from
                // the May 2026 audit) need the actual day-of-month, not
                // just "in 248 days". Formatted with Intl.DateTimeFormat
                // so it localizes if/when we ship i18n.
                const absLabel = new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(dueDate);
                // Round-2 audit Section 6 friction: at-a-glance urgency
                // is hard to read when every card looks identical. Color
                // the pill + left edge by how close the deadline is —
                // overdue is already filtered to the recap, so here we
                // only have to differentiate "this week" (amber) from
                // "later" (neutral gold).
                const urgencyTone =
                  days <= 7
                    ? {
                        border: "border-amber-300/70 dark:border-amber-600/40",
                        pill: "text-amber-700 dark:text-amber-200",
                        dot: "bg-amber-500",
                      }
                    : days <= 30
                      ? {
                          border:
                            "border-gold-300/60 dark:border-gold-600/30",
                          pill: "text-gold-700",
                          dot: "bg-gold-400",
                        }
                      : {
                          border: "",
                          pill: "text-ink-muted",
                          dot: "bg-forest-300 dark:bg-forest-500",
                        };
                return (
                  <li
                    key={r.id}
                    className={`card p-4 ${urgencyTone.border}`}
                  >
                    <div
                      className={`flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] ${urgencyTone.pill}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`size-1.5 rounded-full ${urgencyTone.dot}`}
                      />
                      {days === 0
                        ? "Due today"
                        : `In ${days} day${days === 1 ? "" : "s"}`}
                    </div>
                    <div className="display text-base text-forest-900 mt-1">
                      {r.title}
                    </div>
                    <div className="text-[11px] text-ink-muted mt-1">
                      {absLabel}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* Companies */}
        <section className="mt-8">
          {/* flex-wrap so the "+ New company" link drops below the
              heading instead of being clipped on very narrow foldable
              cover screens (~240px) where html/body has
              overflow-x:clip. */}
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <h2 className="display text-xl text-forest-900">Companies</h2>
            {canCreateCompany ? (
              <Link
                href="/onboarding/new-company"
                className="text-sm text-forest-700 hover:text-forest-900 whitespace-nowrap"
              >
                + New company
              </Link>
            ) : (
              <Link
                href="/billing?reason=company_limit"
                className="text-sm text-ink-muted hover:text-forest-900 inline-flex items-center gap-1.5 whitespace-nowrap"
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
              // story sits in the title attr for hover. When `categoriesUsed`
              // exceeds the starter target, "11/8 cats" reads as a bug, so
              // collapse to "11 cats ✓" once the user has hit or surpassed
              // the goal. The target is a *starter* checklist, not a cap -
              // we celebrate exceeding it, we don't make the math look
              // broken.
              const catsLabel = r
                ? r.categoriesUsed >= r.targetCategories
                  ? `${r.categoriesUsed} cats ✓`
                  : `${r.categoriesUsed}/${r.targetCategories} cats`
                : "";
              const breakdown = r?.hasBankFeed
                ? `${r.triagedTx}/${r.totalTx} tx · ${catsLabel}`
                : r
                  ? r.categoriesUsed >= r.targetCategories
                    ? `${r.categoriesUsed} categories ✓`
                    : `${r.categoriesUsed}/${r.targetCategories} categories`
                  : "-";
              const tooltip = r?.hasBankFeed
                ? `${r.triagedTx} of ${r.totalTx} bank transactions triaged in the last 90 days, and ${r.categoriesUsed} of ${r.targetCategories} starter deduction categories claimed this tax year${r.categoriesUsed > r.targetCategories ? " (target met)" : ""}.`
                : r
                  ? `${r.categoriesUsed} of ${r.targetCategories} starter deduction categories claimed this tax year${r.categoriesUsed > r.targetCategories ? " (target met)" : ""}. Connect a bank to add expensing-engagement to this score.`
                  : "Tax readiness - start logging expenses to see this fill in.";
              return (
                <li
                  key={m.company_id}
                  className="card card-hover p-5 min-w-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
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
                      {/* "Manager · added May 12, 2026" instead of the raw
                          co_q5tejq7b7x slug. Raw public_id stays available
                          on hover so support can still copy it in one
                          step. May 2026 audit, P2 cluster. */}
                      <div
                        className="text-xs text-ink-muted mt-0.5 tracking-wide"
                        title={m.company.public_id}
                      >
                        {isManager ? "Manager" : "Member"}
                        <span className="text-gold-500"> · </span>
                        added{" "}
                        {new Intl.DateTimeFormat("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          timeZone: "UTC",
                        }).format(new Date(m.joined_at))}
                      </div>
                      <div className="mt-3 max-w-sm" title={tooltip}>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                          <span className="inline-flex items-center text-[10px] uppercase tracking-[0.2em] text-gold-700">
                            Tax-ready · {score}%
                            {r ? (
                              <ReadinessHelp
                                score={score}
                                triagedTx={r.triagedTx}
                                totalTx={r.totalTx}
                                categoriesUsed={r.categoriesUsed}
                                targetCategories={r.targetCategories}
                                hasBankFeed={r.hasBankFeed}
                              />
                            ) : null}
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
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {/* One-click bank connection on companies that don't
                        have a Plaid item yet. The May 2026 audit's P2
                        cluster called out that bank-connect was buried
                        behind /forecast → /banks. This surface puts it
                        right next to "Open" so a brand-new company can
                        wire up its feed in a single hop.
                        flex-wrap so the two buttons stack instead of
                        overflowing the card on the narrowest foldable
                        cover screens. */}
                    {r && !r.hasBankFeed ? (
                      <Link
                        href={`/c/${m.company.public_id}/banks`}
                        className="btn-ghost text-sm whitespace-nowrap"
                      >
                        Connect bank
                      </Link>
                    ) : null}
                    <Link
                      href={`/c/${m.company.public_id}/forecast`}
                      className="btn-primary text-sm whitespace-nowrap"
                    >
                      Open
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Tax-savings playbook tile — links into the company's goal page. */}
        {companies.length > 0 ? (
          <section className="mt-8">
            <Link
              href={`/c/${companies[0].company.public_id}/savings-goals`}
              className="block card card-hover p-6 sm:p-7 border-gold-300/60"
            >
              {/* Stack vertically on mobile (the body needs the full
                  card width; otherwise the CTA pins to the right and
                  squeezes the description into a narrow column). */}
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
                    Tax-savings playbook
                  </div>
                  <h2 className="display mt-1 text-xl text-forest-900">
                    Goals to absorb your tax bill
                  </h2>
                  <p className="mt-1 text-sm text-ink-soft leading-relaxed max-w-2xl">
                    Personalized retirement, health, education, and energy
                    moves with step-by-step instructions — built from your
                    actual filing status, income, and state. None are new
                    business expenses.
                  </p>
                </div>
                <span className="text-forest-700 font-medium shrink-0">
                  View playbook &rarr;
                </span>
              </div>
            </Link>
          </section>
        ) : null}

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

/**
 * Collapse reminder rows that share the same (title, due_at) — typical
 * shape: one quarterly-estimate reminder seeded per company. On the
 * dashboard the user sees a single coalesced card; the `/reminders`
 * page can still break them out per company if a power user wants
 * that view. Audit Low finding: three identical "Q2 estimated tax
 * (2026)" rows for a three-company user.
 */
function dedupeReminders<R extends { id: string; title: string; due_at: string }>(
  rows: ReadonlyArray<R>,
): R[] {
  const seen = new Set<string>();
  const out: R[] = [];
  for (const r of rows) {
    const key = `${r.title} ${r.due_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
