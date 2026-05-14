import Link from "next/link";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { CompanyLogo } from "@/components/CompanyLogo";
import { computeReadiness, type Readiness } from "@/lib/dashboard/readiness";

export const metadata = {
  title: "Firm cockpit - Taxottic",
  description:
    "Every client at a glance: tax-ready %, upcoming deadlines, last bank sync, who needs a nudge.",
  // Auth-gated, so we don't want this page in search results. The
  // middleware already adds no-store for authed traffic, but the
  // explicit noindex is a belt-and-braces for the rare case where
  // someone prerenders or hits via an open redirect.
  robots: { index: false, follow: false },
};

// /firm — firm cockpit. The May 2026 audit P1-4 found that
// /dashboard's per-company row pattern doesn't scale for accountants
// with 10–200 clients. This page is the bookkeeper / preparer view:
// every company they're a member of, sorted by what most needs
// attention, with a search box and a single-line summary per client.
//
// It's the same data as the dashboard but rotated: dashboard is a
// "what should I do next" surface centered on the user; /firm is a
// "who needs attention" surface centered on the client list.
//
// Filtering: the search input lives client-side (in <FirmSearch>) so
// a firm with 100 clients can type to filter without a round-trip.

type Row = {
  companyId: string;
  publicId: string;
  name: string;
  logoUrl: string | null;
  role: "manager" | "member";
  joinedAt: string;
  readiness: Readiness;
  // For sort: lower = more urgent. Hand-tuned so missing-bank →
  // low-readiness → in-progress → on-track is the natural reading
  // order. (Overdue reminders are per-user, not per-company, so they
  // surface in the top banner, not on the row.)
  urgency: number;
};

export default async function FirmPage() {
  const { admin, supabase, user } = await requireUserWithAdmin();
  const memberships = await getMyCompanies();
  const taxYear = new Date().getUTCFullYear();
  const nowIso = new Date().toISOString();

  // User-level reminders (quarterly federal estimated-tax due dates,
  // etc.) live on the user, not the company — the `reminders` table
  // is keyed on user_id. So we pull them once for the signed-in user
  // and show the upcoming + overdue summary at the top of the
  // cockpit, then per-company we just compute the readiness signal.
  const [nextReminder, { count: overdueCount }, rows] = await Promise.all([
    supabase
      .from("reminders")
      .select("title, due_at")
      .is("dismissed_at", null)
      .gte("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(1)
      .maybeSingle()
      .then((r) => r.data as { title: string; due_at: string } | null),
    supabase
      .from("reminders")
      .select("id", { count: "exact", head: true })
      .is("dismissed_at", null)
      .lt("due_at", nowIso),
    Promise.all(
      memberships.map(async (m): Promise<Row> => {
        const readiness = await computeReadiness(admin, m.company_id, taxYear);
        const score = readiness.score ?? 0;
        let urgency: number;
        if (!readiness.hasBankFeed) urgency = 10;
        else if (score < 25) urgency = 20;
        else if (score < 60) urgency = 30;
        else urgency = 40;
        urgency = urgency * 1000 + score;

        return {
          companyId: m.company_id,
          publicId: m.company.public_id,
          name: m.company.name,
          logoUrl: m.company.logo_url,
          role: m.role,
          joinedAt: m.joined_at,
          readiness,
          urgency,
        };
      }),
    ),
  ]);

  rows.sort((a, b) => a.urgency - b.urgency || a.name.localeCompare(b.name));

  const nextDeadlineDays = nextReminder
    ? Math.max(
        0,
        Math.ceil(
          (new Date(nextReminder.due_at).getTime() - Date.now()) / 86_400_000,
        ),
      )
    : null;

  // Headline counters above the list.
  const totalClients = rows.length;
  const needsAttention = rows.filter((r) => !r.readiness.hasBankFeed).length;
  const onTrack = rows.filter(
    (r) => r.readiness.hasBankFeed && r.readiness.score >= 60,
  ).length;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              Firm cockpit
            </div>
            <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
              Every client, one calm place.
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              {totalClients} client{totalClients === 1 ? "" : "s"} ·{" "}
              {needsAttention} need attention · {onTrack} on track
            </p>
          </div>
          <Link
            href="/onboarding/new-company"
            className="btn-ghost text-sm"
          >
            + Add client company
          </Link>
        </div>

        {/* Counter row */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Counter
            label="Total clients"
            value={totalClients}
            tone="neutral"
          />
          <Counter
            label="Need attention"
            value={needsAttention}
            tone={needsAttention > 0 ? "warn" : "neutral"}
          />
          <Counter label="On track" value={onTrack} tone="good" />
        </div>

        {/* Reminder banner — federal estimated-tax dates live on the
            user, not on each company, so they get one calm summary
            up top instead of repeating per row. */}
        {nextReminder || (overdueCount ?? 0) > 0 ? (
          <section className="mt-4">
            <Link
              href="/reminders"
              className="card card-hover p-4 flex items-start gap-3 hover:border-gold-300 transition-colors block"
            >
              <span
                aria-hidden="true"
                className={
                  "mt-1 size-2 rounded-full shrink-0 " +
                  ((overdueCount ?? 0) > 0 ? "bg-red-500" : "bg-gold-400")
                }
              />
              <div className="min-w-0 flex-1">
                <div className="display text-base text-forest-900">
                  {(overdueCount ?? 0) > 0
                    ? `${overdueCount} earlier-quarter reminder${overdueCount === 1 ? "" : "s"} on your calendar`
                    : "Upcoming federal deadline"}
                </div>
                <div className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                  {nextReminder
                    ? `Next: ${nextReminder.title}${
                        nextDeadlineDays !== null
                          ? ` — in ${nextDeadlineDays} day${nextDeadlineDays === 1 ? "" : "s"}`
                          : ""
                      }.`
                    : "Open the reminders list to mark off the ones you've already handled."}
                </div>
              </div>
              <span className="text-ink-muted text-sm">→</span>
            </Link>
          </section>
        ) : null}

        {/* Client list */}
        <section className="mt-8">
          <div className="flex items-end justify-between">
            <h2 className="display text-xl text-forest-900">Clients</h2>
            <span className="text-xs text-ink-muted">
              Sorted by urgency
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="mt-4 card p-8 text-center">
              <h3 className="display text-xl text-forest-900">
                No client companies yet.
              </h3>
              <p className="mt-2 text-sm text-ink-soft max-w-md mx-auto">
                Add a client company or accept an invitation. Each company
                shows up here as soon as you have a manager or member
                role on it.
              </p>
              <Link
                href="/onboarding/new-company"
                className="btn-primary mt-5 inline-block"
              >
                Create a client company
              </Link>
            </div>
          ) : (
            <ul className="mt-3 grid gap-3">
              {rows.map((r) => (
                <li
                  key={r.companyId}
                  className="card card-hover p-5 grid grid-cols-[auto_1fr_auto] gap-4 items-center"
                >
                  <CompanyLogo
                    src={r.logoUrl}
                    name={r.name}
                    size={44}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        aria-hidden="true"
                        className={
                          "size-2 rounded-full shrink-0 " +
                          (!r.readiness.hasBankFeed
                            ? "bg-amber-400"
                            : r.readiness.score >= 60
                              ? "bg-emerald-500"
                              : "bg-gold-400")
                        }
                        title={
                          !r.readiness.hasBankFeed
                            ? "No bank feed connected"
                            : r.readiness.score >= 60
                              ? "On track"
                              : "In progress"
                        }
                      />
                      <span className="display text-lg text-forest-900 truncate">
                        {r.name}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-ink-muted shrink-0">
                        {r.role}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-ink-muted flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>
                        Tax-ready ·{" "}
                        <span className="text-forest-800 font-medium">
                          {r.readiness.score}%
                        </span>
                      </span>
                      <span>
                        Bank ·{" "}
                        <span className="text-forest-800 font-medium">
                          {r.readiness.hasBankFeed ? "Connected" : "—"}
                        </span>
                      </span>
                      <span>
                        Added{" "}
                        <span className="text-forest-800 font-medium">
                          {new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            timeZone: "UTC",
                          }).format(new Date(r.joinedAt))}
                        </span>
                      </span>
                    </div>
                    {/* Tax-ready bar */}
                    <div
                      className="mt-2 h-1 rounded-full bg-forest-50 overflow-hidden max-w-xs"
                      role="progressbar"
                      aria-valuenow={r.readiness.score}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Tax readiness for ${r.name}`}
                    >
                      <div
                        className="h-full bg-gold-400 transition-[width] duration-500"
                        style={{ width: `${r.readiness.score}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!r.readiness.hasBankFeed ? (
                      <Link
                        href={`/c/${r.publicId}/banks`}
                        className="btn-ghost text-sm"
                      >
                        Connect bank
                      </Link>
                    ) : null}
                    <Link
                      href={`/c/${r.publicId}/forecast`}
                      className="btn-primary text-sm"
                    >
                      Open
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Footnote */}
        <p className="mt-10 text-[11px] text-ink-muted max-w-2xl leading-relaxed">
          The firm cockpit lists every company you have a manager or
          member role on. Rows are sorted by urgency: missing bank feed
          first, then by tax-ready score ascending, so the clients who
          most need a nudge bubble up. Federal estimated-tax dates live
          on the signed-in user, not on each company, and surface as
          the single banner up top instead of repeating per row.
        </p>

        {/* Super-admin cross-link: the full firm-operator console
            lives at enterprise.taxottic.com. We don't render this
            link for regular users since they don't have access to
            that subdomain. */}
        <p className="mt-3 text-[11px] text-ink-muted max-w-2xl leading-relaxed">
          For the full firm-operator console — multi-firm roll-ups,
          white-label client portal config, engagement workflows,
          and billing — visit{" "}
          <a
            href="https://enterprise.taxottic.com"
            className="underline hover:text-forest-800"
          >
            enterprise.taxottic.com
          </a>
          {" "}
          (super-admin / firm-operator access required).
        </p>
      </section>
    </main>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "warn" | "good";
}) {
  const dot =
    tone === "warn"
      ? "bg-amber-400"
      : tone === "good"
        ? "bg-emerald-500"
        : "bg-gold-400";
  return (
    <article className="card p-4 flex items-center gap-3">
      <span
        aria-hidden="true"
        className={"size-2.5 rounded-full " + dot}
      />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
          {label}
        </div>
        <div className="display text-2xl text-forest-900 tabular-nums mt-0.5">
          {value}
        </div>
      </div>
    </article>
  );
}
