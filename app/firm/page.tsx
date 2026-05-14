import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyLogo } from "@/components/CompanyLogo";
import { requireUserWithAdmin } from "@/lib/auth";
import { getFirmContext } from "@/lib/firm/context";
import { computeReadiness, type Readiness } from "@/lib/dashboard/readiness";

export const metadata = {
  title: "Firm cockpit — Taxottic",
  description:
    "Every client at a glance: engagement status, tax-ready %, upcoming deadlines, last activity.",
  robots: { index: false, follow: false },
};

// /firm — firm cockpit, Phase 1 rewrite.
//
// Pre-rewrite: read from `getMyCompanies()` (companies the *user* is a
// direct member of). That's the wrong shape for an accounting firm
// whose preparers don't own their clients' companies — they have
// engagements with them. A firm with 30 active clients shouldn't have
// to add 30 manager memberships to see the roster.
//
// Post-rewrite: resolve firm context via `getFirmContext()` (which
// reads `firm_members` for the current user), then list every
// `firm_engagements` row for that firm. Each engagement points at a
// `companies` row that the firm has read-only RLS access to (via
// `firm_has_active_engagement_with`). Status is surfaced per-row so
// pending invitations don't hide behind active clients.
//
// Users with no firm membership get redirected to
// /firms/request-account by `requireFirmContext()` — but this page
// uses the softer `getFirmContext()` so users with one foot in the
// firm world and one in the consumer world (super-admins, internal
// staff testing) see a graceful "no firm yet" panel with the
// signup CTA instead of a bounce.

type ClientRow = {
  engagementId: string;
  companyId: string;
  publicId: string;
  name: string;
  logoUrl: string | null;
  taxYear: number;
  kind: "tax_prep" | "audit_support" | "bookkeeping" | "advisory";
  status:
    | "pending_firm"
    | "pending_client"
    | "active"
    | "completed"
    | "declined"
    | "terminated";
  assignedPreparerId: string | null;
  assignedPreparerName: string | null;
  scopeSummary: string | null;
  requestedAt: string;
  readiness: Readiness | null;
  /** Sort key: lower bubbles to the top. Pending invitations on top
   *  of active-no-bank-feed on top of active-low-score on top of
   *  active-healthy. */
  urgency: number;
};

const KIND_LABEL: Record<ClientRow["kind"], string> = {
  tax_prep: "Tax prep",
  audit_support: "Audit response",
  bookkeeping: "Bookkeeping",
  advisory: "Advisory",
};

const STATUS_LABEL: Record<ClientRow["status"], string> = {
  pending_firm: "Awaiting your response",
  pending_client: "Awaiting client",
  active: "Active",
  completed: "Completed",
  declined: "Declined",
  terminated: "Ended",
};

const STATUS_TONE: Record<
  ClientRow["status"],
  "warn" | "info" | "good" | "muted"
> = {
  pending_firm: "warn",
  pending_client: "info",
  active: "good",
  completed: "muted",
  declined: "muted",
  terminated: "muted",
};

export default async function FirmPage() {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await getFirmContext();
  const taxYear = new Date().getUTCFullYear();
  const nowIso = new Date().toISOString();

  // No firm yet — render a soft onboarding panel. Don't redirect,
  // because the same /firm URL is the natural place to land a new
  // visitor: it's the surface they searched for, and bouncing them
  // out of context to /firms/request-account is jarring.
  if (!ctx) {
    return (
      <main id="main" className="min-h-screen">
        <AppHeader email={user.email ?? undefined} />
        <section className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Firm cockpit
          </div>
          <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
            You&apos;re not part of a firm yet.
          </h1>
          <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-2xl">
            The firm cockpit is where accounting firms manage their
            client roster: tax-prep engagements, document inboxes, the
            year-end pipeline. To request a firm account, fill out the
            short form and a member of our team will provision your
            subdomain within one business day.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/firms/request-account"
              className="btn-primary text-sm"
            >
              Request a firm account →
            </Link>
            <Link
              href="/dashboard"
              className="btn-ghost text-sm"
            >
              Back to my dashboard
            </Link>
          </div>
          <p className="mt-8 text-[11px] text-ink-muted leading-relaxed max-w-xl">
            Already on an invitation? Open the link in the email we
            sent — accepting an invitation creates your firm
            membership and lands you back here automatically.
          </p>
        </section>
      </main>
    );
  }

  const firm = ctx.firm;

  // Pull every engagement for this firm — including pending and
  // completed — sorted by urgency below. PostgREST nested select on
  // companies works because the engagement row gives RLS the
  // company_id and `firm_has_active_engagement_with` is satisfied
  // for the active rows; pending/completed rows we hit via the
  // service-role admin client to make sure we never accidentally
  // hide a pending invite the firm needs to action.
  const { data: engagementsRaw } = await admin
    .from("firm_engagements")
    .select(
      "id, firm_id, company_id, tax_year, kind, status, assigned_preparer_id, scope_summary, requested_at, company:companies!inner(id, public_id, name, logo_url, deleted_at)",
    )
    .eq("firm_id", firm.id)
    .order("requested_at", { ascending: false });

  type RawEng = NonNullable<typeof engagementsRaw>[number] & {
    company: {
      id: string;
      public_id: string;
      name: string;
      logo_url: string | null;
      deleted_at: string | null;
    };
  };
  const engagements = ((engagementsRaw ?? []) as unknown as RawEng[]).filter(
    (e) => e.company && e.company.deleted_at === null,
  );

  // Resolve preparer display names in one round-trip.
  const preparerIds = Array.from(
    new Set(
      engagements
        .map((e) => e.assigned_preparer_id)
        .filter((x): x is string => !!x),
    ),
  );
  const { data: preparers } = preparerIds.length
    ? await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", preparerIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const preparerName = new Map<string, string>();
  for (const p of preparers ?? []) {
    preparerName.set(
      p.id,
      p.full_name?.trim() || p.email || p.id.slice(0, 8),
    );
  }

  // Compute readiness for active engagements only — pending/completed
  // doesn't need a per-client score on the cockpit and the readiness
  // query is the heaviest per-row cost.
  const readinessRows = await Promise.all(
    engagements.map(async (e): Promise<ClientRow> => {
      const isActive = e.status === "active";
      const readiness = isActive
        ? await computeReadiness(admin, e.company.id, e.tax_year)
        : null;

      let urgencyTier: number;
      if (e.status === "pending_firm") urgencyTier = 0;
      else if (e.status === "pending_client") urgencyTier = 10;
      else if (e.status === "active") {
        if (!readiness?.hasBankFeed) urgencyTier = 20;
        else if ((readiness?.score ?? 0) < 25) urgencyTier = 30;
        else if ((readiness?.score ?? 0) < 60) urgencyTier = 40;
        else urgencyTier = 50;
      } else if (e.status === "completed") urgencyTier = 80;
      else urgencyTier = 90;
      const urgency = urgencyTier * 1000 + (100 - (readiness?.score ?? 0));

      return {
        engagementId: e.id,
        companyId: e.company.id,
        publicId: e.company.public_id,
        name: e.company.name,
        logoUrl: e.company.logo_url,
        taxYear: e.tax_year,
        kind: e.kind,
        status: e.status,
        assignedPreparerId: e.assigned_preparer_id,
        assignedPreparerName: e.assigned_preparer_id
          ? preparerName.get(e.assigned_preparer_id) ?? null
          : null,
        scopeSummary: e.scope_summary,
        requestedAt: e.requested_at,
        readiness,
        urgency,
      };
    }),
  );
  readinessRows.sort(
    (a, b) => a.urgency - b.urgency || a.name.localeCompare(b.name),
  );

  // Top-of-cockpit metrics.
  const activeRows = readinessRows.filter((r) => r.status === "active");
  const pendingRows = readinessRows.filter(
    (r) => r.status === "pending_firm" || r.status === "pending_client",
  );
  const needsAttentionCount = activeRows.filter(
    (r) => !r.readiness?.hasBankFeed || (r.readiness?.score ?? 0) < 60,
  ).length;

  // Recent activity (Phase 1: just the firm-wide feed). RLS lets the
  // owner/manager see everything; preparers see only assigned-to-them.
  const { data: recentActivity } = await admin
    .from("firm_activity_log")
    .select("id, kind, summary, created_at, company_id, engagement_id, payload")
    .eq("firm_id", firm.id)
    .order("created_at", { ascending: false })
    .limit(8);

  // Upcoming deadlines: federal estimated tax dates live on the user
  // (carried over from the prior cockpit). When we ship Phase 4 we'll
  // additionally derive per-engagement filing deadlines.
  const { data: nextReminder } = await admin
    .from("reminders")
    .select("title, due_at")
    .is("dismissed_at", null)
    .gte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const nextDeadlineDays = nextReminder
    ? Math.max(
        0,
        Math.ceil(
          (new Date(nextReminder.due_at).getTime() - Date.now()) / 86_400_000,
        ),
      )
    : null;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              {firm.name} ·{" "}
              <span className="text-ink-muted normal-case tracking-wide">
                {firm.tier} tier
              </span>
            </div>
            <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
              Every client, one calm place.
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              {activeRows.length} active ·{" "}
              {pendingRows.length} pending ·{" "}
              {needsAttentionCount} need a nudge
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/firm/clients/new"
              className="btn-primary text-sm"
            >
              + Onboard a client
            </Link>
            <Link
              href="/firm/settings"
              className="btn-ghost text-sm"
            >
              Firm settings
            </Link>
          </div>
        </div>

        {/* Counter row */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Counter
            label="Active engagements"
            value={activeRows.length}
            tone="neutral"
          />
          <Counter
            label="Pending"
            value={pendingRows.length}
            tone={pendingRows.length > 0 ? "warn" : "neutral"}
          />
          <Counter
            label="Need attention"
            value={needsAttentionCount}
            tone={needsAttentionCount > 0 ? "warn" : "good"}
          />
        </div>

        {/* Federal-deadline banner — same UX as the prior cockpit. */}
        {nextReminder ? (
          <section className="mt-4">
            <Link
              href="/reminders"
              className="card card-hover p-4 flex items-start gap-3 hover:border-gold-300 transition-colors block"
            >
              <span
                aria-hidden="true"
                className="mt-1 size-2 rounded-full shrink-0 bg-gold-400"
              />
              <div className="min-w-0 flex-1">
                <div className="display text-base text-forest-900">
                  Upcoming federal deadline
                </div>
                <div className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                  Next: {nextReminder.title}
                  {nextDeadlineDays !== null
                    ? ` — in ${nextDeadlineDays} day${nextDeadlineDays === 1 ? "" : "s"}`
                    : ""}
                  . Tap to open the full reminder list.
                </div>
              </div>
              <span className="text-ink-muted text-sm">→</span>
            </Link>
          </section>
        ) : null}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_18rem]">
          {/* Client list */}
          <section>
            <div className="flex items-end justify-between">
              <h2 className="display text-xl text-forest-900">Clients</h2>
              <span className="text-xs text-ink-muted">
                Pending first, then by urgency
              </span>
            </div>

            {readinessRows.length === 0 ? (
              <div className="mt-4 card p-6 sm:p-8 text-center">
                <h3 className="display text-xl text-forest-900">
                  Roster is empty.
                </h3>
                <p className="mt-2 text-sm text-ink-soft max-w-md mx-auto">
                  Invite your first client. They&apos;ll get an email
                  with a one-tap acceptance link; when they accept
                  we&apos;ll auto-create their company and open the
                  engagement so you can start working immediately.
                </p>
                <Link
                  href="/firm/clients/new"
                  className="btn-primary mt-5 inline-block"
                >
                  Onboard your first client
                </Link>
              </div>
            ) : (
              <ul className="mt-3 grid gap-3">
                {readinessRows.map((r) => (
                  <li
                    key={r.engagementId}
                    className="card card-hover p-5 grid grid-cols-[auto_1fr_auto] gap-4 items-center"
                  >
                    <CompanyLogo
                      src={r.logoUrl}
                      name={r.name}
                      size={44}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span className="display text-lg text-forest-900 truncate">
                          {r.name}
                        </span>
                        <StatusPill status={r.status} />
                        <span className="text-[10px] uppercase tracking-[0.18em] text-ink-muted shrink-0">
                          {KIND_LABEL[r.kind]} · {r.taxYear}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-ink-muted flex flex-wrap gap-x-3 gap-y-0.5">
                        {r.assignedPreparerName ? (
                          <span>
                            Preparer:{" "}
                            <span className="text-forest-800 font-medium">
                              {r.assignedPreparerName}
                            </span>
                          </span>
                        ) : (
                          <span className="text-amber-700">
                            Unassigned
                          </span>
                        )}
                        {r.readiness ? (
                          <>
                            <span>
                              Tax-ready ·{" "}
                              <span className="text-forest-800 font-medium">
                                {r.readiness.score}%
                              </span>
                            </span>
                            <span>
                              Bank ·{" "}
                              <span className="text-forest-800 font-medium">
                                {r.readiness.hasBankFeed
                                  ? "Connected"
                                  : "—"}
                              </span>
                            </span>
                          </>
                        ) : null}
                      </div>
                      {r.scopeSummary ? (
                        <div className="mt-1 text-xs text-ink-soft truncate">
                          {r.scopeSummary}
                        </div>
                      ) : null}
                      {r.readiness ? (
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
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/firm/clients/${r.engagementId}`}
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

          {/* Activity sidebar — Phase 1: empty until events start
              flowing. Phase 4 adds real-time. */}
          <aside>
            <div className="flex items-end justify-between">
              <h2 className="display text-xl text-forest-900">Activity</h2>
              <span className="text-xs text-ink-muted">Last 8</span>
            </div>
            <div className="mt-3 card p-4">
              {(recentActivity ?? []).length === 0 ? (
                <p className="text-xs text-ink-muted leading-relaxed">
                  Nothing yet. As clients log income, upload documents,
                  or your team marks engagements complete, the
                  timeline will fill in here.
                </p>
              ) : (
                <ul className="grid gap-3 text-xs">
                  {(recentActivity ?? []).map((a) => (
                    <li key={a.id} className="grid gap-0.5">
                      <span className="text-forest-900 leading-snug">
                        {a.summary ?? a.kind}
                      </span>
                      <span className="text-[10px] text-ink-muted">
                        {new Intl.DateTimeFormat("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(a.created_at))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>

        <p className="mt-10 text-[11px] text-ink-muted max-w-2xl leading-relaxed">
          The cockpit lists engagements your firm has accepted plus any
          still awaiting action. Pending invitations float to the top
          so you can respond without hunting. Open a row to drill into
          the client&apos;s books — your firm has read-only access via
          the active engagement.
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

function StatusPill({ status }: { status: ClientRow["status"] }) {
  const tone = STATUS_TONE[status];
  const tones: Record<typeof tone, string> = {
    warn: "bg-amber-100 text-amber-800 border-amber-200",
    info: "bg-cream-200 text-forest-800 border-forest-200",
    good: "bg-emerald-50 text-emerald-700 border-emerald-200",
    muted: "bg-cream-100 text-ink-muted border-forest-100",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border ${tones[tone]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
