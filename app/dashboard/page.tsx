import Link from "next/link";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { evaluateBadges } from "@/lib/badges/evaluate";
import { BADGES } from "@/lib/badges/catalog";
import { BadgeMedal } from "@/components/BadgeMedal";
import { ensureQuarterlyReminders } from "@/lib/reminders/seed";
import { formatCents } from "@/lib/tax/forecast";
import { buildGreeting } from "@/lib/dashboard/greeting";

export default async function DashboardPage() {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const taxYear = new Date().getUTCFullYear();

  // Lazy-evaluate badges + ensure reminders exist on every dashboard hit.
  // Both are idempotent and use admin client so the inserts work regardless
  // of cookie auth quirks. Reads filter explicitly by user_id so they remain
  // scoped correctly even with admin privileges.
  await Promise.all([
    evaluateBadges(admin, user.id),
    ensureQuarterlyReminders(admin, user.id, taxYear),
  ]);

  const companies = await getMyCompanies();

  // Personalized greeting (full name from profile, falls back to email handle).
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const greeting = buildGreeting({
    fullName: profile?.full_name,
    email: user.email,
  });

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
  const nowIso = new Date().toISOString();
  const [
    { data: upcomingReminders },
    { data: overdueReminders },
    { data: activeGoals },
    { data: badges },
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
            <Link
              href="/onboarding/new-company"
              className="text-sm text-forest-700 hover:text-forest-900"
            >
              + New company
            </Link>
          </div>
          <ul className="mt-3 grid gap-3">
            {companies.map((m) => (
              <li
                key={m.company_id}
                className="card card-hover p-5 flex items-center justify-between"
              >
                <div>
                  <div className="display text-xl text-forest-900">
                    {m.company.name}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5 tracking-wide">
                    {m.company.public_id} - {m.role}
                  </div>
                </div>
                <Link
                  href={`/c/${m.company.public_id}/forecast`}
                  className="btn-ghost"
                >
                  Open
                </Link>
              </li>
            ))}
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
                  <li key={g.id} className="card p-4">
                    <div className="display text-base text-forest-900 truncate">
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

        {/* Badges */}
        <section className="mt-8">
          <div className="flex items-end justify-between">
            <h2 className="display text-xl text-forest-900">
              Your achievements
            </h2>
            <span className="text-xs text-ink-muted">
              {badges?.length ?? 0} earned
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
            {Object.values(BADGES).map((b) => {
              const earned = (badges ?? []).some(
                (x) => x.badge_code === b.code,
              );
              return (
                <div
                  key={b.code}
                  className="card p-3 flex flex-col items-center text-center gap-2"
                  title={b.description}
                >
                  <BadgeMedal code={b.code} earned={earned} size={48} />
                  <div
                    className={
                      "text-[11px] font-medium leading-tight " +
                      (earned ? "text-forest-900" : "text-ink-muted")
                    }
                  >
                    {b.title}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
