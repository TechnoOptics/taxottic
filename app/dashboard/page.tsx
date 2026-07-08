import Link from "next/link";
import { redirect } from "next/navigation";
import {
  requireUserWithAdmin,
  getMyCompanies,
  type CompanyMembership,
} from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { PersonalDashboard } from "./PersonalDashboard";
import { AppDownloadBanner } from "@/components/AppDownloadBanner";
import { CompanyLogo } from "@/components/CompanyLogo";
import { evaluateBadges } from "@/lib/badges/evaluate";
import { AchievementsGrid } from "@/components/AchievementsGrid";
import { TrialBanner } from "@/components/TrialBanner";
import { getTrialState } from "@/lib/plans/usage";
import { runTrialGuard } from "@/lib/security/trial-guard";
import { MedalCelebration } from "@/components/MedalCelebration";
import { WelcomeTour } from "@/components/WelcomeTour";
import { ensureQuarterlyReminders } from "@/lib/reminders/seed";
import {
  formatCents,
  forecast,
  type ForecastResult,
} from "@/lib/tax/forecast";
import { buildPersonalForecastInput } from "@/lib/tax/personal-forecast-input";
import {
  buildCompanyForecast,
  type IncomeRow,
  type ExpenseRow,
  type ForecastTaxProfile,
  type ForecastBusinessProfile,
} from "@/lib/tax/company-forecast";
import { resolveCombine } from "@/lib/tax/combine-setting";
import { buildGreeting } from "@/lib/dashboard/greeting";
import { computeReadiness, type Readiness } from "@/lib/dashboard/readiness";
import { checkCompanyLimit } from "@/lib/plans/usage";
import { completeWelcomeTour } from "@/app/actions/tour";
import { GoalDismissButton } from "@/components/GoalDismissButton";
import { purgeExpiredRecycleBin } from "@/app/actions/recycle-bin";
import { ReminderDismissButton } from "@/components/ReminderDismissButton";
import { ReadinessHelp } from "@/components/ReadinessHelp";
import { WebOnly } from "@/components/WebOnly";
import { OutstandingTasksBanner } from "@/components/OutstandingTasksBanner";
import { OutstandingTasksPopup } from "@/components/OutstandingTasksPopup";
import { getOutstandingTasks, type OutstandingItem } from "@/lib/tasks/outstanding";

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
    .in("role", ["member", "expenser"])
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
  // result. The redirect checks happen after, once everything has
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
        "full_name, tour_completed_at, tax_filer_type, tax_disclaimer_accepted_at, combine_personal_business",
      )
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const profile = profileResult.data;

  // Legal disclaimer gate, the very first onboarding step. Before a
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

  // Item 13: an invited employee's workspace is the company they joined,
  // not a personal tax setup. Don't force them through the W-2-vs-business
  // filer-type fork; send them straight to their company. A manager (who
  // created a company) still completes their own filer-type below.
  const memberOnly =
    companies.length > 0 && companies.every((m) => m.role !== "manager");
  if (profile && !profile.tax_filer_type && memberOnly) {
    redirect(`/c/${companies[0].company.public_id}/expenses`);
  }

  // Personalized greeting + filer-type fork. New signups land on the
  // dashboard before they've picked W-2 vs business; route them to
  // /onboarding/filer-type. Individual (W-2 / personal) filers get
  // their OWN dashboard — personal readiness, 1040 snapshot, goals,
  // playbook — fully independent of the business side (they used to be
  // bounced to /personal/forecast and never had a home).
  if (profile && !profile.tax_filer_type) {
    redirect("/onboarding/filer-type");
  }
  if (profile?.tax_filer_type === "w2") {
    return (
      <PersonalDashboard
        admin={admin}
        supabase={supabase}
        user={user}
        fullName={profile?.full_name ?? null}
      />
    );
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
          <div className="surface p-6 sm:p-10 text-center">
            <div className="kicker-sm">
              {isSuperAdmin ? "Operator view" : "Welcome"}
            </div>
            <h1 className="display mt-3 text-4xl text-forest-900">
              {isSuperAdmin
                ? "You're signed in as a super-admin."
                : "Let's set up your first company."}
            </h1>
            <p className="mt-3 text-sm text-ink-soft">
              {isSuperAdmin
                ? `Hi ${user.email}. This is the consumer dashboard. Super-admin work lives in HQ / Enterprise, pick a portal from the profile menu.`
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

  // Plain-member dashboard: a user with zero manager memberships doesn't
  // need the owner-oriented tax forecast, tax-savings playbook, or active
  // goals, those are financial-strategy tools for whoever owns the
  // business. What a member DOES need day to day: a quick way to log an
  // expense/drive, a look at their own recent activity, and the same
  // outstanding-tasks/reminders/achievements every user gets. Skipping
  // the owner branch here also skips its two expensive per-company
  // fetches (goals, computeReadiness) entirely rather than computing and
  // then discarding them.
  const isMemberOnly = companies.every((m) => m.role !== "manager");
  if (isMemberOnly) {
    return renderMemberDashboard({
      user,
      supabase,
      admin,
      taxYear,
      greeting,
      companies,
      showWelcomeTour,
      tourDisplayName,
      newlyEarnedCodes,
    });
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
    { data: mileageTripRows },
    readinessByCompany,
    { data: personalTaxProfile },
    { data: personalExpenseRows },
  ] = await Promise.all([
    supabase
      .from("reminders")
      .select("id, kind, title, due_at")
      // Explicit owner filter, belt-and-braces, same as getMyCompanies.
      // RLS lets a super-admin read EVERY user's reminders, so without
      // this the consumer dashboard recap showed (and counted) other
      // people's overdue reminders for super-admin accounts, and the
      // dismiss-X (correctly scoped to user_id) could never clear them.
      .eq("user_id", user.id)
      .is("dismissed_at", null)
      .gte("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(3),
    supabase
      .from("reminders")
      .select("id, kind, title, due_at")
      .eq("user_id", user.id)
      .is("dismissed_at", null)
      .lt("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(3),
    supabase
      .from("goals")
      .select("id, title, target_cents, saved_cents, status, deadline")
      // Owner filter, same RLS-super-admin caveat as the reminders
      // queries above; without it a super-admin's dashboard would list
      // other users' goals.
      .eq("user_id", user.id)
      // PERSONAL goals only: the dashboard is the personal hub, so
      // business goals stay on /goals (per-company section) and on the
      // company's own savings-goals page — never mixed in here.
      .is("company_id", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("badges")
      .select("badge_code, awarded_at")
      .eq("user_id", user.id)
      .order("awarded_at", { ascending: false }),
    // Tracked business drives across ALL the user's companies (keyed on
    // driver_user_id) for the at-a-glance mileage tile below.
    admin
      .from("mileage_trips")
      .select("started_at, distance_miles, deduction_cents")
      .eq("driver_user_id", user.id)
      .eq("classification", "business")
      .eq("tax_year", taxYear),
    Promise.all(
      companies.map(async (m) => {
        const r = await computeReadiness(admin, m.company_id, taxYear);
        return [m.company_id, r] as const;
      }),
    ).then((entries) => new Map<string, Readiness>(entries)),
    // Personal (1040) tax profile + logged personal deductions. The
    // dashboard is the owner's PERSONAL hub, so it leads with their own
    // year-end picture — computed by the same engine /personal/forecast
    // uses. Business numbers stay in each company's hub. A null profile
    // just means they haven't set up personal taxes yet.
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
  // reminders card sets it today, the audit's Low finding was that
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
          "Welcome, these are the standard quarterly tax dates that fell before today. Open the list to mark off ones you already handled.",
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
        ? "Log your first expense, your forecast comes alive after this"
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
      // same codebase under /admin/**, render them here, no
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

  // Trial-fraud guard runs lazily on the FIRST dashboard load, if
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

  // Mileage at-a-glance, YTD business-drive deduction across all of the
  // user's companies, surfaced in the hero stat band rather than buried
  // in /mileage.
  let mileageYtdCents = 0;
  let mileageYtdMiles = 0;
  for (const t of (mileageTripRows ?? []) as Array<{
    started_at: string;
    distance_miles: number | null;
    deduction_cents: number | null;
  }>) {
    mileageYtdCents += Number(t.deduction_cents ?? 0);
    mileageYtdMiles += Number(t.distance_miles ?? 0);
  }
  const hasMileage = mileageYtdMiles > 0;

  // ── Hero stat band ────────────────────────────────────────────────
  // Three glanceable figures under the greeting (personal year-end
  // snapshot, mileage YTD, next deadline) so the dashboard opens on the
  // owner's OWN "where do I stand" instead of a single business's
  // readiness. Each company's readiness stays on its own card in the
  // "Your businesses" list below, where it belongs.
  //
  // Personal year-end snapshot (their own 1040) for the hero lead tile,
  // built with the same engine as /personal/forecast. A null profile
  // means the owner hasn't set up their personal taxes yet, so the tile
  // becomes a "set up" CTA instead of a number.
  const personalForecast: ForecastResult | null = personalTaxProfile
    ? forecast(
        buildPersonalForecastInput(
          personalTaxProfile,
          personalExpenseRows ?? [],
          taxYear,
        ),
      )
    : null;

  // "incl. business" line: when the owner's business is COMBINED into their
  // personal return, surface the with-business bottom line under the
  // personal-only figure (rather than replacing it). Scoped to the primary
  // company they manage and labeled with its name, so it's honest about
  // exactly what's folded in. Uses the same engine + real personal profile
  // as that company's own forecast, so the number matches /c/.../forecast.
  const primaryManaged = companies.find((m) => m.role === "manager") ?? null;
  let combinedBusiness:
    | { companyName: string; result: ForecastResult }
    | null = null;
  if (primaryManaged && personalTaxProfile) {
    const cid = primaryManaged.company_id;
    const [
      { data: bizCompany },
      { data: bizProfile },
      { data: bizIncome },
      { data: bizExpenses },
      { data: bizTrips },
    ] = await Promise.all([
      admin
        .from("companies")
        .select("entity_type, state_code")
        .eq("id", cid)
        .maybeSingle(),
      admin
        .from("business_profiles")
        .select("*")
        .eq("company_id", cid)
        .eq("tax_year", taxYear)
        .maybeSingle(),
      admin
        .from("monthly_income")
        .select("amount_cents, month, recurrence")
        .eq("company_id", cid)
        .eq("tax_year", taxYear),
      admin
        .from("monthly_expenses")
        .select(
          "amount_cents, month, category_code, recurrence, recurrence_end_month",
        )
        .eq("classification", "business")
        .eq("company_id", cid)
        .eq("tax_year", taxYear),
      admin
        .from("mileage_trips")
        .select("deduction_cents")
        .eq("company_id", cid)
        .eq("classification", "business")
        .eq("tax_year", taxYear),
    ]);
    const combined = resolveCombine(
      profile?.combine_personal_business,
      bizCompany?.entity_type ?? null,
    );
    if (combined) {
      const trips = (bizTrips ?? []) as { deduction_cents: number }[];
      const { result } = buildCompanyForecast({
        taxYear,
        currentMonth: new Date().getUTCMonth() + 1,
        company: {
          state_code: bizCompany?.state_code ?? null,
          entity_type: bizCompany?.entity_type ?? null,
        },
        taxProfile: personalTaxProfile as unknown as ForecastTaxProfile,
        businessProfile:
          (bizProfile as unknown as ForecastBusinessProfile | null) ?? null,
        incomes: (bizIncome ?? []) as IncomeRow[],
        expenses: (bizExpenses ?? []) as ExpenseRow[],
        trackedYtdMileageCents: trips.reduce(
          (a, t) => a + Number(t.deduction_cents ?? 0),
          0,
        ),
        trackedTripCount: trips.length,
      });
      combinedBusiness = { companyName: primaryManaged.company.name, result };
    }
  }
  // Nearest upcoming deadline, in whole days, for the third stat tile.
  const nextReminder =
    upcomingReminders && upcomingReminders.length
      ? [...dedupeReminders(upcomingReminders)].sort(
          (a, b) =>
            new Date(a.due_at).getTime() - new Date(b.due_at).getTime(),
        )[0]
      : null;
  const nextDeadlineDays = nextReminder
    ? Math.max(
        0,
        Math.ceil(
          (new Date(nextReminder.due_at).getTime() - Date.now()) / 86_400_000,
        ),
      )
    : null;

  // Outstanding tasks, unclassified drives + transactions awaiting a
  // business/personal or category call. Best-effort: a tally failure
  // must never break the dashboard render. Follows the same "first
  // company" convention this page already uses elsewhere (line below,
  // the hero stat band's forecast link).
  let outstanding: { items: OutstandingItem[]; count: number } = {
    items: [],
    count: 0,
  };
  try {
    outstanding = await getOutstandingTasks(supabase, {
      userId: user.id,
      companyId: companies[0]?.company.id ?? null,
      companyPublicId: companies[0]?.company.public_id ?? null,
    });
  } catch {
    /* best-effort */
  }

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <AppDownloadBanner />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-8 sm:py-12">
        <header>
          <div className="kicker-sm">Tax year {taxYear}</div>
          <h1 className="display mt-3 text-4xl sm:text-5xl text-forest-900 leading-[1.05]">
            {greeting.head}
          </h1>
          <p className="mt-3 text-base text-ink-soft max-w-xl leading-relaxed">
            {greeting.pleasantry}
          </p>
        </header>

        {outstanding.count > 0 ? (
          <div className="mt-4">
            <OutstandingTasksBanner
              count={outstanding.count}
              firstHref={outstanding.items[0]?.href ?? "/mileage/classify"}
            />
          </div>
        ) : null}
        <OutstandingTasksPopup
          count={outstanding.count}
          items={outstanding.items}
        />

        <TrialBanner trial={trial} />

        {/* Hero stat band, three glanceable figures (personal year-end
            snapshot, mileage YTD, next deadline) so the dashboard opens on
            the owner's OWN "where do I stand" instead of a stack of equal
            cards. On mobile the personal tile takes the full row with the
            two figures beneath it; on sm+ all three form one row. */}
        <section className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Link
            href="/personal/forecast"
            className="surface surface-hover col-span-2 p-5 flex flex-col justify-center min-w-0"
          >
            <div className="kicker-sm">Your personal taxes</div>
            {personalForecast ? (
              <>
                <div className="display text-2xl sm:text-3xl text-forest-900 mt-1 tabular-nums">
                  {personalForecast.refundCents > 0
                    ? `${formatCents(personalForecast.refundCents)} back`
                    : `${formatCents(personalForecast.stillOwedCents)} owed`}
                </div>
                <div className="text-[13px] text-ink-muted mt-0.5 truncate">
                  Projected 1040 ·{" "}
                  {formatCents(personalForecast.totalTaxCents)} total tax
                </div>
                {/* Combine is on: show the with-business bottom line under
                    the personal-only figure, clearly labeled with the
                    company folded in. */}
                {combinedBusiness ? (
                  <div className="text-[13px] text-gold-700 mt-1 truncate">
                    incl. {combinedBusiness.companyName}:{" "}
                    {combinedBusiness.result.refundCents > 0
                      ? `${formatCents(combinedBusiness.result.refundCents)} back`
                      : `${formatCents(combinedBusiness.result.stillOwedCents)} owed`}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="display text-2xl text-forest-900 mt-1">
                  Set up &rarr;
                </div>
                <div className="text-[13px] text-ink-muted mt-0.5 truncate">
                  Add your personal tax profile
                </div>
              </>
            )}
          </Link>

          <Link
            href="/mileage"
            className="surface surface-hover col-span-1 p-5 flex flex-col justify-center min-w-0"
          >
            <div className="kicker-sm">Mileage YTD</div>
            <div className="display text-2xl sm:text-3xl text-forest-900 mt-1 tabular-nums">
              {formatCents(mileageYtdCents)}
            </div>
            <div className="text-[13px] text-ink-muted mt-0.5 truncate">
              {hasMileage
                ? `${mileageYtdMiles.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })} business mi`
                : "Track your drives"}
            </div>
          </Link>

          <Link
            href="/reminders"
            className="surface surface-hover col-span-1 p-5 flex flex-col justify-center min-w-0"
          >
            <div className="kicker-sm">Next deadline</div>
            <div className="display text-2xl sm:text-3xl text-forest-900 mt-1">
              {nextDeadlineDays === null ? (
                "-"
              ) : nextDeadlineDays === 0 ? (
                "Today"
              ) : (
                <>
                  {nextDeadlineDays}
                  <span className="text-base text-ink-muted font-normal">
                    {" "}
                    days
                  </span>
                </>
              )}
            </div>
            <div className="text-[13px] text-ink-muted mt-0.5 truncate">
              {nextReminder ? nextReminder.title : "Nothing scheduled"}
            </div>
          </Link>
        </section>

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
          <section className="mt-10 grid gap-3">
            {recap.map((r, i) => (
              <div
                key={i}
                className="surface surface-hover relative p-5 flex items-start gap-3.5"
              >
                <Link
                  href={r.href}
                  aria-label={r.title}
                  className="absolute inset-0 rounded-[1.125rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                />
                {/* One accent: every recap dot is gold. Urgency is
                    carried by copy + sort order, not a second colour -
                    keeps the surface calm (redesign rule). */}
                <div className="mt-1.5 size-2 rounded-full shrink-0 bg-gold-400" />
                <div className="min-w-0 flex-1 pr-6">
                  <div className="display text-base text-forest-900">
                    {r.title}
                  </div>
                  <div className="text-[13px] text-ink-muted mt-1 leading-relaxed">
                    {r.body}
                  </div>
                </div>
                {r.dismissAction === "overdue-reminders" ? (
                  <div className="absolute right-3 top-3 z-10">
                    <ReminderDismissButton />
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {/* Upcoming reminders. Multi-company users were seeing the
            same quarterly-estimate reminder rendered once per company
            (audit's Low finding: three identical "Q2 estimated tax
            (2026)" rows at "in 33 days"). Dedupe in render by
            (title, due_at), the user only needs to see the deadline
            once. The deeper /reminders page can still split by company
            if a power user wants the per-company view. */}
        {upcomingReminders && upcomingReminders.length > 0 ? (
          <section className="mt-10">
            <div className="flex items-center justify-between">
              <div className="kicker-sm">Coming up</div>
              <Link
                href="/reminders"
                className="text-[13px] text-gold-700 hover:text-forest-900"
              >
                All reminders &rarr;
              </Link>
            </div>
            <ul className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {dedupeReminders(upcomingReminders).map((r) => {
                const dueDate = new Date(r.due_at);
                const days = Math.max(
                  0,
                  Math.ceil((dueDate.getTime() - Date.now()) / 86_400_000),
                );
                // Absolute date underneath the relative label. CPAs (P3
                // from the May 2026 audit) need the actual day-of-month.
                const absLabel = new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(dueDate);
                // One accent: a single calm gold dot + neutral label on
                // every card (the old amber/gold/neutral tri-state added
                // a competing colour). Proximity is read from the "In N
                // days" copy, not from card colour.
                return (
                  <li key={r.id} className="surface p-5">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-ink-muted">
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-gold-400"
                      />
                      {days === 0
                        ? "Due today"
                        : `In ${days} day${days === 1 ? "" : "s"}`}
                    </div>
                    <div className="display text-base text-forest-900 mt-2">
                      {r.title}
                    </div>
                    <div className="text-[12px] text-ink-muted mt-1">
                      {absLabel}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* Companies */}
        <section className="mt-10">
          {/* flex-wrap so the "+ New company" link drops below the
              heading instead of being clipped on very narrow foldable
              cover screens (~240px) where html/body has
              overflow-x:clip. */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="kicker-sm">
              {companies.length === 1 ? "Your business" : "Your businesses"}
            </div>
            {canCreateCompany ? (
              <Link
                href="/onboarding/new-company"
                className="text-sm text-forest-700 hover:text-forest-900 whitespace-nowrap"
              >
                + New company
              </Link>
            ) : (
              // 3.1.1: the upgrade upsell links to billing, web only. In
              // the native app, state the free-plan limit without a route
              // to purchase.
              <WebOnly
                fallback={
                  <span className="text-sm text-ink-muted inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span aria-hidden="true">🔒</span>
                    Free plan: 1 company
                  </span>
                }
              >
                <Link
                  href="/billing?reason=company_limit"
                  className="text-sm text-ink-muted hover:text-forest-900 inline-flex items-center gap-1.5 whitespace-nowrap"
                  title={newCompanyTooltip}
                >
                  <span aria-hidden="true">🔒</span>
                  + New company (Pro)
                </Link>
              </WebOnly>
            )}
          </div>
          <ul className="mt-4 grid gap-3">
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
                  className="surface surface-hover p-6 min-w-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <CompanyLogo
                      src={m.company.logo_url}
                      name={m.company.name}
                      size={48}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="display text-2xl text-forest-900 truncate">
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
                          className="mt-2 h-2 rounded-full bg-forest-100/70 overflow-hidden"
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

        {/* Tax-savings playbook tile, links into the company's goal page. */}
        {companies.length > 0 ? (
          <section className="mt-10">
            <Link
              href={`/c/${companies[0].company.public_id}/savings-goals`}
              className="block surface surface-hover p-6 sm:p-8"
            >
              {/* Stack vertically on mobile (the body needs the full
                  card width; otherwise the CTA pins to the right and
                  squeezes the description into a narrow column). */}
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="kicker-sm">Tax-savings playbook</div>
                  <h2 className="display mt-2 text-2xl text-forest-900">
                    Goals to absorb your tax bill
                  </h2>
                  <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-2xl">
                    Personalized retirement, health, education, and energy
                    moves with step-by-step instructions, built from your
                    actual filing status, income, and state. None are new
                    business expenses.
                  </p>
                </div>
                <span className="text-sm font-medium text-gold-700 shrink-0">
                  View playbook &rarr;
                </span>
              </div>
            </Link>
          </section>
        ) : null}

        {/* Active goals */}
        {activeGoals && activeGoals.length > 0 ? (
          <section className="mt-10">
            <div className="flex items-center justify-between gap-3">
              <div className="kicker-sm">Personal goals</div>
              <Link
                href="/goals"
                className="text-sm font-medium text-gold-700 hover:text-forest-900"
              >
                All goals &rarr;
              </Link>
            </div>
            <ul className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {activeGoals.map((g) => {
                const pct =
                  g.target_cents > 0
                    ? Math.min(
                        100,
                        Math.round((g.saved_cents / g.target_cents) * 100),
                      )
                    : 0;
                return (
                  <li key={g.id} className="surface p-5 relative">
                    <div className="absolute top-2 right-2">
                      <GoalDismissButton goalId={g.id} goalTitle={g.title} />
                    </div>
                    <div className="display text-lg text-forest-900 truncate pr-6">
                      {g.title}
                    </div>
                    <div className="text-xs text-ink-muted mt-1">
                      {formatCents(g.saved_cents)} of{" "}
                      {formatCents(g.target_cents)}
                    </div>
                    <div className="mt-3 h-2 rounded-full bg-forest-100/70 overflow-hidden">
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
          <section className="mt-10">
            <div className="surface p-6 flex items-center justify-between gap-4">
              <div>
                <div className="display text-lg text-forest-900">
                  Set a goal to stay ahead.
                </div>
                <p className="text-sm text-ink-soft mt-1">
                  Pick a tax-savings target and watch the gap close.
                </p>
              </div>
              <Link href="/goals" className="btn-ghost shrink-0">
                New goal
              </Link>
            </div>
          </section>
        )}

        {/* Achievements: each medal sits in a thick metal frame; earned ones
            get an animated holographic shimmer wave. */}
        <section className="mt-10">
          <div className="flex items-center justify-between gap-3">
            <div className="kicker-sm">Your achievements</div>
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
 * Dashboard for a user with zero manager memberships, a plain team
 * member. Skips the owner-oriented tax forecast, tax-savings playbook,
 * and active-goals sections entirely (and the two expensive per-company
 * fetches that back them: computeReadiness + goals) in favor of what a
 * member actually needs day to day: quick-add links, their own recent
 * activity, and the same outstanding-tasks/reminders/achievements every
 * user gets.
 */
async function renderMemberDashboard(args: {
  user: Awaited<ReturnType<typeof requireUserWithAdmin>>["user"];
  supabase: Awaited<ReturnType<typeof requireUserWithAdmin>>["supabase"];
  admin: Awaited<ReturnType<typeof requireUserWithAdmin>>["admin"];
  taxYear: number;
  greeting: ReturnType<typeof buildGreeting>;
  companies: CompanyMembership[];
  showWelcomeTour: boolean;
  tourDisplayName: string | null;
  newlyEarnedCodes: string[];
}) {
  const {
    user,
    supabase,
    admin,
    taxYear,
    greeting,
    companies,
    showWelcomeTour,
    tourDisplayName,
    newlyEarnedCodes,
  } = args;

  // "Primary" company for quick-add links + recent activity, the first
  // one the user joined, same "first company" convention the owner
  // dashboard uses for its hero forecast link.
  const primary = companies[0]?.company ?? null;

  let outstanding: { items: OutstandingItem[]; count: number } = {
    items: [],
    count: 0,
  };
  try {
    outstanding = await getOutstandingTasks(supabase, {
      userId: user.id,
      companyId: primary?.id ?? null,
      companyPublicId: primary?.public_id ?? null,
    });
  } catch {
    /* best-effort */
  }

  const nowIso = new Date().toISOString();
  const monthStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  ).toISOString();

  const [
    { data: upcomingReminders },
    { data: badges },
    { data: mileageTripRows },
    { count: thisMonthExpenseCount },
    { data: recentExpenses },
  ] = await Promise.all([
    supabase
      .from("reminders")
      .select("id, kind, title, due_at")
      .eq("user_id", user.id)
      .is("dismissed_at", null)
      .gte("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(3),
    supabase
      .from("badges")
      .select("badge_code, awarded_at")
      .eq("user_id", user.id)
      .order("awarded_at", { ascending: false }),
    admin
      .from("mileage_trips")
      .select("distance_miles, deduction_cents")
      .eq("driver_user_id", user.id)
      .eq("classification", "business")
      .eq("tax_year", taxYear),
    admin
      .from("monthly_expenses")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", monthStart),
    admin
      .from("monthly_expenses")
      .select(
        "id, month, amount_cents, notes, created_at, category:deduction_categories(label)",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const mileageTrips = mileageTripRows ?? [];
  const mileageYtdCents = mileageTrips.reduce(
    (a, t) => a + Number(t.deduction_cents ?? 0),
    0,
  );
  const mileageYtdMiles = mileageTrips.reduce(
    (a, t) => a + Number(t.distance_miles ?? 0),
    0,
  );
  const thisMonthExpenses = thisMonthExpenseCount ?? 0;
  const nextReminder = upcomingReminders?.[0] ?? null;
  const nextDeadlineDays = nextReminder
    ? Math.ceil(
        (new Date(nextReminder.due_at).getTime() - Date.now()) / 86_400_000,
      )
    : null;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-8 sm:py-12">
        <header>
          <div className="kicker-sm">Tax year {taxYear}</div>
          <h1 className="display mt-3 text-4xl sm:text-5xl text-forest-900 leading-[1.05]">
            {greeting.head}
          </h1>
          <p className="mt-3 text-base text-ink-soft max-w-xl leading-relaxed">
            {greeting.pleasantry}
          </p>
          {primary ? (
            <p className="mt-1 text-sm text-ink-muted">{primary.name}</p>
          ) : null}
        </header>

        {outstanding.count > 0 ? (
          <div className="mt-4">
            <OutstandingTasksBanner
              count={outstanding.count}
              firstHref={outstanding.items[0]?.href ?? "/mileage/classify"}
            />
          </div>
        ) : null}
        <OutstandingTasksPopup count={outstanding.count} items={outstanding.items} />

        {/* Quick actions, the three things a member actually does day
            to day. Big, obvious tap targets rather than nav-menu hunting. */}
        <section className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link
            href={primary ? `/c/${primary.public_id}/expenses` : "#"}
            className="surface surface-hover p-5 flex items-center gap-3"
          >
            <span aria-hidden="true" className="text-2xl">
              🧾
            </span>
            <div>
              <div className="display text-lg text-forest-900">Add expense</div>
              <div className="text-[13px] text-ink-muted">
                Connect, upload a receipt, or enter by hand
              </div>
            </div>
          </Link>
          <Link
            href="/mileage"
            className="surface surface-hover p-5 flex items-center gap-3"
          >
            <span aria-hidden="true" className="text-2xl">
              🚗
            </span>
            <div>
              <div className="display text-lg text-forest-900">Log mileage</div>
              <div className="text-[13px] text-ink-muted">
                Auto-tracked or add a drive by hand
              </div>
            </div>
          </Link>
          <Link
            href={primary ? `/c/${primary.public_id}/chat` : "#"}
            className="surface surface-hover p-5 flex items-center gap-3"
          >
            <span aria-hidden="true" className="text-2xl">
              💬
            </span>
            <div>
              <div className="display text-lg text-forest-900">Chat</div>
              <div className="text-[13px] text-ink-muted">
                Message your team
              </div>
            </div>
          </Link>
        </section>

        {/* Your activity, spending + mileage this user has personally
            logged, plus the next reminder. Mirrors the owner dashboard's
            hero stat band shape but scoped to this one person. */}
        <section className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="surface p-5">
            <div className="kicker-sm">Logged this month</div>
            <div className="display text-2xl text-forest-900 mt-1">
              {thisMonthExpenses}
            </div>
            <div className="text-[13px] text-ink-muted mt-0.5">
              {thisMonthExpenses === 1 ? "expense" : "expenses"}
            </div>
          </div>
          <div className="surface p-5">
            <div className="kicker-sm">Mileage YTD</div>
            <div className="display text-2xl text-forest-900 mt-1 tabular-nums">
              {formatCents(mileageYtdCents)}
            </div>
            <div className="text-[13px] text-ink-muted mt-0.5">
              {mileageYtdMiles.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}{" "}
              mi
            </div>
          </div>
          <Link
            href="/reminders"
            className="surface surface-hover p-5 col-span-2 sm:col-span-1"
          >
            <div className="kicker-sm">Next deadline</div>
            <div className="display text-2xl text-forest-900 mt-1">
              {nextDeadlineDays === null
                ? "-"
                : nextDeadlineDays <= 0
                  ? "Today"
                  : `${nextDeadlineDays}d`}
            </div>
            <div className="text-[13px] text-ink-muted mt-0.5 truncate">
              {nextReminder ? nextReminder.title : "Nothing scheduled"}
            </div>
          </Link>
        </section>

        {/* Recent activity, this user's own last few logged expenses,
            so "what have I been logging" is answerable at a glance
            without leaving the dashboard. */}
        {recentExpenses && recentExpenses.length > 0 ? (
          <section className="mt-8">
            <div className="kicker-sm">Your recent activity</div>
            <ul className="mt-3 grid gap-2">
              {recentExpenses.map((e) => {
                const cat = e.category as unknown as { label: string } | null;
                return (
                  <li
                    key={e.id}
                    className="rounded-lg border border-forest-100 bg-white/60 px-4 py-2.5 text-sm flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-forest-900 truncate">
                        {e.notes || cat?.label || "Expense"}
                      </div>
                      <div className="text-[11px] text-ink-muted">
                        {cat?.label ?? "Uncategorized"}
                      </div>
                    </div>
                    <div className="text-forest-900 tabular-nums shrink-0">
                      {formatCents(e.amount_cents)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* Achievements: same universal gamification every user gets. */}
        <section className="mt-10">
          <div className="flex items-center justify-between gap-3">
            <div className="kicker-sm">Your achievements</div>
            <span className="text-xs text-ink-muted">
              {badges?.length ?? 0} earned
            </span>
          </div>
          <AchievementsGrid earnedCodes={(badges ?? []).map((b) => b.badge_code)} />
        </section>
      </section>

      <WelcomeTour
        show={showWelcomeTour}
        completeAction={completeWelcomeTour}
        displayName={tourDisplayName}
      />
      <MedalCelebration newlyEarnedCodes={newlyEarnedCodes} />
    </main>
  );
}

/**
 * Collapse reminder rows that share the same (title, due_at), typical
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
    const key = `${r.title}\u0000${r.due_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
