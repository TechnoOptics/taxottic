import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import {
  resendOutreach,
  cancelOutreach,
  extendOutreach,
} from "./actions";

// /firm/outreach — pending invitations not yet on Taxottic.
//
// firm_client_outreach is the queue of "we invited them; they
// haven't signed up yet" prospects. Once a prospect creates a
// Taxottic account, the convert_firm_outreach() RPC promotes the
// outreach into an active engagement and they disappear from the
// pending tab here.
//
// This page is the management surface: re-send, extend, cancel.
// The cockpit (Phase 1) shows accepted engagements; the cockpit
// doesn't list outreach because the firm hasn't done anything yet
// from a tax-prep perspective. Surfacing it here keeps the cockpit
// focused on actual work.

type SearchParams = Promise<{
  status?: string;
  import?: string;
  total?: string;
  existing?: string;
  outreach?: string;
  errors?: string;
}>;

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "converted", label: "Converted" },
  { value: "declined", label: "Cancelled" },
  { value: "expired", label: "Expired" },
] as const;

export default async function OutreachPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const sp = await searchParams;
  const statusFilter = STATUS_OPTIONS.find((s) => s.value === sp.status)
    ? sp.status!
    : "pending";

  const { data: outreachRows } = await admin
    .from("firm_client_outreach")
    .select(
      "id, email, full_name, business_name, tax_year, kind, message, status, created_at, expires_at, responded_at, invited_by, converted_engagement_id",
    )
    .eq("firm_id", ctx.firm.id)
    .eq("status", statusFilter)
    .order("created_at", { ascending: false })
    .limit(200);

  // Counts per status for the filter chips.
  const { data: counts } = await admin
    .from("firm_client_outreach")
    .select("status")
    .eq("firm_id", ctx.firm.id);
  const tally: Record<string, number> = {};
  for (const r of counts ?? []) {
    tally[r.status as string] = (tally[r.status as string] ?? 0) + 1;
  }

  const showImportBanner = sp.import === "1";

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              <Link
                href="/firm"
                className="underline decoration-dotted hover:text-forest-900"
              >
                Firm cockpit
              </Link>{" "}
              · Outreach
            </div>
            <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
              Invitations in flight.
            </h1>
            <p className="mt-2 text-sm text-ink-soft max-w-2xl">
              Prospects you&apos;ve invited who haven&apos;t created a
              Taxottic account yet. Once they sign up, the engagement
              auto-creates and moves to the cockpit.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/firm/clients/import"
              className="btn-primary text-sm"
            >
              + Bulk import
            </Link>
            <Link
              href="/firm/clients/new"
              className="btn-ghost text-sm"
            >
              + Single client
            </Link>
          </div>
        </div>

        {showImportBanner ? (
          <div className="mt-6 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm dark:bg-emerald-900/30">
            <div className="font-semibold text-emerald-900 dark:text-emerald-100">
              Import complete.
            </div>
            <div className="mt-1 text-[13px] leading-relaxed text-emerald-900/90 dark:text-emerald-100/90">
              {sp.existing ?? "0"} engagement
              {sp.existing === "1" ? "" : "s"} created for existing
              clients · {sp.outreach ?? "0"} outreach
              {sp.outreach === "1" ? "" : "es"} sent to new prospects
              {Number(sp.errors ?? "0") > 0
                ? ` · ${sp.errors} error${sp.errors === "1" ? "" : "s"} (re-run the failed rows)`
                : ""}
              .
            </div>
          </div>
        ) : null}

        {/* Status filter chips */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {STATUS_OPTIONS.map((s) => {
            const active = s.value === statusFilter;
            return (
              <Link
                key={s.value}
                href={`/firm/outreach?status=${s.value}`}
                className={
                  "inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs border " +
                  (active
                    ? "bg-forest-900 text-cream border-forest-900"
                    : "bg-white/70 text-ink-soft border-forest-100 hover:border-forest-300")
                }
              >
                {s.label}
                <span className="opacity-75 tabular-nums">
                  {tally[s.value] ?? 0}
                </span>
              </Link>
            );
          })}
        </div>

        <section className="mt-6">
          {(outreachRows ?? []).length === 0 ? (
            <div className="card p-8 text-center">
              <h2 className="display text-xl text-forest-900">
                Nothing here.
              </h2>
              <p className="mt-2 text-sm text-ink-soft max-w-md mx-auto">
                When you invite a client who isn&apos;t on Taxottic
                yet, their outreach row lands here until they sign up.
              </p>
              <Link
                href="/firm/clients/new"
                className="btn-primary mt-5 inline-block"
              >
                Invite your first prospect
              </Link>
            </div>
          ) : (
            <ul className="grid gap-3">
              {(outreachRows ?? []).map((o) => (
                <li key={o.id} className="card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="display text-base text-forest-900 truncate">
                          {o.full_name?.trim() || o.email}
                        </span>
                        <span className="text-[11px] text-ink-muted">
                          {o.email}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-ink-muted flex flex-wrap gap-x-3 gap-y-0.5">
                        {o.business_name ? <span>{o.business_name}</span> : null}
                        <span>{prettyKind(o.kind)} · {o.tax_year}</span>
                        <span>
                          Invited{" "}
                          {new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }).format(new Date(o.created_at))}
                        </span>
                        <span>
                          Expires{" "}
                          {new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                          }).format(new Date(o.expires_at))}
                        </span>
                      </div>
                      {o.message ? (
                        <p className="mt-2 text-xs text-ink-soft leading-relaxed whitespace-pre-wrap">
                          {o.message}
                        </p>
                      ) : null}
                    </div>
                    {o.status === "pending" ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <form action={resendOutreach}>
                          <input type="hidden" name="id" value={o.id} />
                          <button className="btn-ghost text-xs px-3 h-9">
                            Re-send
                          </button>
                        </form>
                        <form action={extendOutreach}>
                          <input type="hidden" name="id" value={o.id} />
                          <button className="btn-ghost text-xs px-3 h-9">
                            +60 days
                          </button>
                        </form>
                        <form
                          action={cancelOutreach}
                          onSubmit={undefined}
                        >
                          <input type="hidden" name="id" value={o.id} />
                          <button className="btn-ghost text-xs px-3 h-9 hover:text-red-700">
                            Cancel
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}

function prettyKind(k: string): string {
  return (
    {
      tax_prep: "Tax prep",
      audit_support: "Audit response",
      bookkeeping: "Bookkeeping",
      advisory: "Advisory",
    }[k] ?? k
  );
}
