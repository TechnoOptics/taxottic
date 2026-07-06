import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CompanyLogo } from "@/components/CompanyLogo";
import { ForecastDisclaimer } from "@/components/ForecastDisclaimer";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { computeReadiness } from "@/lib/dashboard/readiness";
import { formatCents } from "@/lib/tax/forecast";
import { respondToEngagement } from "./respond/actions";

// /firm/clients/{engagementId}, deep view of one engaged client.
//
// Renders inside the firm cockpit chrome (not the company chrome at
// /c/{publicId}/*), so the preparer always sees "I'm viewing this
// as the firm" instead of accidentally identifying as the client.
// The "Open client view" CTA at the bottom does jump into the
// /c/{publicId}/forecast surface for when the preparer actually
// needs the same view the client sees.
//
// What's on this page in Phase 1:
//   - Engagement metadata (status, kind, tax year, assigned preparer,
//     scope summary, dates)
//   - Client / company info (name, EIN, state, entity type)
//   - Books snapshot (YTD income / expenses, current forecast totals)
//   - Activity feed scoped to this engagement
//   - Quick-action shortcuts that will fill in over later phases
//     (Phase 4 = real notifications, Phase 5 = documents,
//     Phase 6 = scheduling, Phase 7 = invoicing)
//
// What's NOT here yet (Phase 4-7):
//   - Document inbox (Phase 5)
//   - Meeting / Zoom scheduler (Phase 6)
//   - Invoice / payment surface (Phase 7)
//   - Auto-drafted tax forms (Phase 5)

type Params = Promise<{ engagementId: string }>;

const KIND_LABEL: Record<string, string> = {
  tax_prep: "Tax preparation",
  audit_support: "Audit response",
  bookkeeping: "Bookkeeping",
  advisory: "Advisory",
};

const STATUS_LABEL: Record<string, string> = {
  pending_firm: "Awaiting your response",
  pending_client: "Awaiting client",
  active: "Active",
  completed: "Completed",
  declined: "Declined",
  terminated: "Ended",
};

export default async function FirmClientPage({
  params,
}: {
  params: Params;
}) {
  const { engagementId } = await params;
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  // Load the engagement + linked company. Service-role read so RLS
  // doesn't gate us on the assigned-preparer check; the page itself
  // gates by `engagement.firm_id === ctx.firm.id` below to make sure
  // a member of firm A can't view firm B's engagement by URL guess.
  const { data: eng } = await admin
    .from("firm_engagements")
    .select(
      "id, firm_id, company_id, tax_year, kind, status, scope_summary, client_note, firm_note, requested_at, responded_at, assigned_preparer_id, requested_by_side",
    )
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng) notFound();
  if (eng.firm_id !== ctx.firm.id) {
    // Wrong firm. 404 so we don't disclose the row exists.
    notFound();
  }

  const { data: company } = await admin
    .from("companies")
    .select(
      "id, public_id, name, legal_name, entity_type, state_code, logo_url, ein, created_at, deleted_at",
    )
    .eq("id", eng.company_id)
    .maybeSingle();
  if (!company || company.deleted_at) notFound();

  // Books snapshot, YTD income + expenses + readiness. Reuses the
  // existing helper. Reading the engagement's tax_year so an audit-
  // support engagement on tax year 2024 doesn't accidentally show
  // 2026 income.
  const [readiness, { data: incomeRows }, { data: expenseRows }] =
    await Promise.all([
      computeReadiness(admin, company.id, eng.tax_year),
      admin
        .from("monthly_income")
        .select("amount_cents")
        .eq("company_id", company.id)
        .eq("tax_year", eng.tax_year),
      admin
        .from("monthly_expenses")
        .select("amount_cents")
        .eq("company_id", company.id)
        .eq("tax_year", eng.tax_year),
    ]);

  const ytdIncome = (incomeRows ?? []).reduce(
    (a, r) => a + (r.amount_cents ?? 0),
    0,
  );
  const ytdExpenses = (expenseRows ?? []).reduce(
    (a, r) => a + (r.amount_cents ?? 0),
    0,
  );

  // Assigned preparer display.
  let preparerName: string | null = null;
  if (eng.assigned_preparer_id) {
    const { data: p } = await admin
      .from("profiles")
      .select("full_name, email")
      .eq("id", eng.assigned_preparer_id)
      .maybeSingle();
    preparerName = p?.full_name?.trim() || p?.email || null;
  }

  // Activity for this engagement.
  const { data: activity } = await admin
    .from("firm_activity_log")
    .select("id, kind, summary, created_at, actor_side, payload")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false })
    .limit(20);

  // Permission: anyone in the firm sees the engagement. Mark whether
  // the current user is the assigned preparer so the UI can call
  // that out.
  const isAssignedToMe = eng.assigned_preparer_id === user.id;

  // For active engagements we'll later show pending action items
  // (Phase 4). Phase 1: status-based banner.
  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <CompanyLogo
              src={company.logo_url}
              name={company.name}
              size={56}
            />
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
                <Link
                  href="/firm"
                  className="underline decoration-dotted hover:text-forest-900"
                >
                  Firm cockpit
                </Link>{" "}
                · Client
              </div>
              <h1 className="display mt-1 text-3xl sm:text-4xl text-forest-900 leading-tight">
                {company.name}
              </h1>
              <div className="mt-1 text-xs text-ink-muted flex flex-wrap gap-x-2 gap-y-0.5">
                <span>{KIND_LABEL[eng.kind] ?? eng.kind}</span>
                <span>·</span>
                <span>Tax year {eng.tax_year}</span>
                {company.entity_type ? (
                  <>
                    <span>·</span>
                    <span>{prettyEntity(company.entity_type)}</span>
                  </>
                ) : null}
                {company.state_code ? (
                  <>
                    <span>·</span>
                    <span>{company.state_code}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/firm/clients/${eng.id}/documents`}
              className="btn-ghost text-sm"
            >
              Documents
            </Link>
            <Link
              href={`/firm/clients/${eng.id}/meetings`}
              className="btn-ghost text-sm"
            >
              Meetings
            </Link>
            <Link
              href={`/firm/clients/${eng.id}/invoices`}
              className="btn-ghost text-sm"
            >
              Invoices
            </Link>
            <Link
              href={`/firm/clients/${eng.id}/filings`}
              className="btn-ghost text-sm"
            >
              Filings
            </Link>
            <Link
              href={`/firm/clients/${eng.id}/w9`}
              className="btn-ghost text-sm"
            >
              W-9s
            </Link>
            <Link
              href={`/firm/clients/${eng.id}/banks`}
              className="btn-ghost text-sm"
            >
              Banks
            </Link>
            <Link
              href={`/c/${company.public_id}/forecast`}
              className="btn-primary text-sm"
            >
              Open client view →
            </Link>
          </div>
        </div>

        {/* Status banner */}
        <div
          className={`mt-6 rounded-2xl border p-4 text-sm ${statusBannerTone(
            eng.status,
          )}`}
        >
          <div className="font-semibold">
            {STATUS_LABEL[eng.status] ?? eng.status}
          </div>
          <div className="mt-1 text-[13px] leading-relaxed opacity-90">
            {statusBannerCopy(eng.status, eng.requested_by_side)}
          </div>
          {eng.status === "pending_firm" ? (
            <form action={respondToEngagement} className="mt-3 flex flex-wrap gap-2">
              <input type="hidden" name="engagement_id" value={engagementId} />
              <button
                type="submit"
                name="action"
                value="accept"
                className="btn-primary text-xs px-3 h-9"
              >
                Accept engagement
              </button>
              <button
                type="submit"
                name="action"
                value="decline"
                className="btn-ghost text-xs px-3 h-9"
              >
                Decline
              </button>
            </form>
          ) : null}
        </div>

        {/* Books snapshot */}
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <Stat label="YTD income" value={formatCents(ytdIncome)} />
          <Stat label="YTD deductible" value={formatCents(ytdExpenses)} />
          <Stat
            label="Tax-ready"
            value={`${readiness.score}%`}
            sub={
              readiness.hasBankFeed
                ? `${readiness.triagedTx}/${readiness.totalTx} tx triaged · ${readiness.categoriesUsed}/${readiness.targetCategories} categories`
                : `${readiness.categoriesUsed}/${readiness.targetCategories} categories, no bank feed`
            }
          />
        </div>

        {/* Engagement detail + assigned preparer */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_18rem]">
          <section className="card p-5 sm:p-6">
            <h2 className="display text-xl text-forest-900">
              Engagement details
            </h2>
            <dl className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <DescRow
                label="Scope"
                value={eng.scope_summary || "Not specified"}
              />
              <DescRow
                label="Assigned preparer"
                value={
                  preparerName
                    ? preparerName + (isAssignedToMe ? " (you)" : "")
                    : "Unassigned"
                }
              />
              <DescRow
                label="Requested by"
                value={
                  eng.requested_by_side === "client"
                    ? "Client"
                    : "Your firm"
                }
              />
              <DescRow
                label="Requested at"
                value={new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).format(new Date(eng.requested_at))}
              />
              {eng.responded_at ? (
                <DescRow
                  label="Responded at"
                  value={new Intl.DateTimeFormat("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  }).format(new Date(eng.responded_at))}
                />
              ) : null}
              {eng.client_note ? (
                <DescRow label="Client note" value={eng.client_note} />
              ) : null}
              {eng.firm_note ? (
                <DescRow label="Internal note" value={eng.firm_note} />
              ) : null}
            </dl>
          </section>

          {/* Activity feed for this engagement */}
          <aside className="card p-4">
            <div className="flex items-end justify-between">
              <h2 className="display text-base text-forest-900">
                Activity
              </h2>
              <span className="text-[10px] text-ink-muted">
                Last 20
              </span>
            </div>
            <div className="mt-3">
              {(activity ?? []).length === 0 ? (
                <p className="text-xs text-ink-muted leading-relaxed">
                  Nothing yet for this engagement.
                </p>
              ) : (
                <ul className="grid gap-3 text-xs">
                  {(activity ?? []).map((a) => (
                    <li key={a.id} className="grid gap-0.5">
                      <span className="text-forest-900 leading-snug">
                        {a.summary ?? a.kind}
                      </span>
                      <span className="text-[10px] text-ink-muted">
                        {a.actor_side} ·{" "}
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


        <div className="mt-8">
          <ForecastDisclaimer variant="card" />
        </div>
      </section>
    </main>
  );
}

function statusBannerTone(status: string): string {
  switch (status) {
    case "pending_firm":
      return "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100";
    case "pending_client":
      return "border-cream-300 bg-cream-100 text-forest-800 dark:bg-forest-800/60 dark:text-cream-100";
    case "active":
      return "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100";
    case "completed":
      return "border-forest-100 bg-cream-50 text-ink-soft";
    default:
      return "border-forest-100 bg-cream-50 text-ink-soft";
  }
}

function statusBannerCopy(status: string, requestedBy: string): string {
  switch (status) {
    case "pending_firm":
      return requestedBy === "client"
        ? "The client requested this engagement. Accept to start working on their books, or decline with a note."
        : "Waiting for the assigned preparer to confirm the engagement scope.";
    case "pending_client":
      return "We've sent an invitation to the client. They'll appear here once they accept.";
    case "active":
      return "Engagement is live. Your firm has read-only access to the client's books and can post documents / messages.";
    case "completed":
      return "Engagement is closed. Records are read-only and retained for compliance.";
    case "declined":
      return "Engagement was declined. No further action needed.";
    case "terminated":
      return "Engagement was ended early. See the internal note for context.";
    default:
      return "";
  }
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <article className="card p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
        {label}
      </div>
      <div className="display text-2xl text-forest-900 tabular-nums mt-1">
        {value}
      </div>
      {sub ? (
        <div className="mt-1 text-[11px] text-ink-muted leading-relaxed">
          {sub}
        </div>
      ) : null}
    </article>
  );
}

function DescRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
        {label}
      </dt>
      <dd className="mt-0.5 text-forest-900">{value}</dd>
    </div>
  );
}

function prettyEntity(t: string): string {
  return (
    {
      sole_prop: "Sole Proprietor",
      single_llc: "Single-Member LLC",
      multi_llc: "Multi-Member LLC",
      s_corp: "S-Corp",
      c_corp: "C-Corp",
      partnership: "Partnership",
      self_employed_1099: "1099 / Self-Employed",
    }[t] ?? t
  );
}
