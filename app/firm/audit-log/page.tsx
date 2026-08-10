import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";

// Tier 2 #3: Tenant audit-log viewer.
//
// What this page is:
//   The firm-facing window into `admin_cross_tenant_access_log` -
//   the table that records every time a Taxottic super-admin reads
//   or writes data on behalf of one of your clients. Tenant trust
//   begins with "who looked at my data and when," and we already
//   built the table (Round-2 governance audit, migrations
//   20260514000001 + 20260514000002). This surface is just the UX.
//
// Why the firm sees this and not the underlying company directly:
//   The consumer side (`/c/{publicId}/audit-log`) already exists for
//   the company owner. But when an accounting firm holds the
//   engagement, the firm is the trust anchor for their client base -
//   they want to verify their own SLA to *their* clients, and they
//   want the rollup across all of them in one place. So this page
//   joins on every company the firm has an engagement with.
//
// Historical-rows policy (post-engagement-end):
//   We deliberately include completed/terminated engagements in the
//   company_id IN filter, not just active ones. The IRS retention
//   rules + discovery requirements ask firms to be able to answer
//   "who accessed this client's data" for the year following
//   engagement end, plus the 3-year statute window for amended-
//   return audit. Trimming to active-only would silently lose that
//   visibility. If a firm ever needs to *suppress* a former client
//   from the viewer (e.g., the client requested data portability +
//   deletion), the right place is a per-engagement "suppressed_from_
//   audit_log" flag, not implemented yet but documented here so
//   the reasoning survives.
//
// Scope:
//   - Read-only (writes happen exclusively via the SECURITY DEFINER
//     RPCs documented in 20260514000001).
//   - Last 200 events, ordered newest-first. The table is indexed on
//     (company_id, accessed_at desc); the IN filter on the firm's
//     companies stays sargable for reasonable firm sizes (< 1k).

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  admin_user_id: string;
  company_id: string;
  path: string | null;
  reason: string | null;
  kind: string;
  request_host: string | null;
  accessed_at: string;
};

export default async function FirmAuditLogPage() {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();

  // Every company that the firm has an active engagement on. We
  // intentionally include completed/terminated engagements too, a
  // firm wants to keep auditing their former clients' historical
  // access for the year after engagement end, since IRS retention
  // and discovery rules can ask about it.
  const { data: engagementsRaw } = await admin
    .from("firm_engagements")
    .select("company_id, company:companies!inner(id, name)")
    .eq("firm_id", ctx.firm.id);
  type Eng = { company_id: string; company: { id: string; name: string } };
  const engagements = (engagementsRaw ?? []) as unknown as Eng[];
  const companyIds = Array.from(new Set(engagements.map((e) => e.company_id)));
  const companyName = new Map<string, string>();
  for (const e of engagements) companyName.set(e.company.id, e.company.name);

  let rows: Row[] = [];
  if (companyIds.length > 0) {
    const { data } = await admin
      .from("admin_cross_tenant_access_log")
      .select(
        "id, admin_user_id, company_id, path, reason, kind, request_host, accessed_at",
      )
      .in("company_id", companyIds)
      .order("accessed_at", { ascending: false })
      .limit(200);
    rows = (data ?? []) as Row[];
  }

  // Resolve admin emails so the firm sees "support@taxottic.com" not
  // a bare UUID. The `admin_user_id` is a `public.profiles.id` per
  // the migration.
  const adminIds = Array.from(new Set(rows.map((r) => r.admin_user_id)));
  const { data: adminProfiles } = adminIds.length
    ? await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", adminIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const adminLabel = new Map<string, string>();
  for (const p of adminProfiles ?? []) {
    adminLabel.set(p.id, p.full_name?.trim() || p.email || p.id.slice(0, 8));
  }

  const reads = rows.filter((r) => r.kind === "read").length;
  const writes = rows.filter((r) => r.kind === "write").length;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          · Audit log
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Who touched your clients&apos; data.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-2xl">
          Every cross-tenant access by a Taxottic support engineer is
          recorded here. Reads (page loads) are deduped within a
          5-minute window per surface; writes always require a
          justification of at least 5 characters and are recorded
          one-row-per-event. Showing the most recent 200 events across{" "}
          {companyIds.length} client{companyIds.length === 1 ? "" : "s"}.
        </p>

        <div className="mt-6 grid sm:grid-cols-3 gap-3">
          <Stat label="Total events" value={rows.length} />
          <Stat label="Reads" value={reads} />
          <Stat label="Writes" value={writes} tone={writes > 0 ? "warn" : "neutral"} />
        </div>

        {rows.length === 0 ? (
          <div className="mt-6 card p-6 text-center">
            <h2 className="display text-xl text-forest-900">
              No cross-tenant access on record.
            </h2>
            <p className="mt-2 text-sm text-ink-soft max-w-md mx-auto">
              When a Taxottic engineer needs to investigate a support
              ticket on behalf of one of your clients, you&apos;ll
              see the row land here in real time.
            </p>
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-[0.15em] text-ink-muted text-left">
                <tr>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Engineer</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Surface</th>
                  <th className="py-2 pr-3">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-forest-100 align-top"
                  >
                    <td className="py-2 pr-3 text-ink-soft tabular-nums whitespace-nowrap">
                      {new Date(r.accessed_at).toLocaleString("en-US")}
                    </td>
                    <td className="py-2 pr-3">
                      <KindPill kind={r.kind} />
                    </td>
                    <td className="py-2 pr-3 text-forest-900">
                      {adminLabel.get(r.admin_user_id) ??
                        r.admin_user_id.slice(0, 8)}
                    </td>
                    <td className="py-2 pr-3 text-forest-900">
                      {companyName.get(r.company_id) ??
                        r.company_id.slice(0, 8)}
                    </td>
                    <td className="py-2 pr-3 text-ink-soft font-mono text-xs">
                      {r.path ?? "-"}
                    </td>
                    <td className="py-2 pr-3 text-ink-soft">
                      {r.reason ?? <span className="text-ink-muted">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-8 text-[11px] text-ink-muted max-w-2xl leading-relaxed">
          The cross-tenant access log retains rows indefinitely.
          Former clients stay visible here even after the engagement
          ends, so the firm can answer post-engagement audit
          questions during the 3-year amended-return window. If
          you need to report a specific access event, copy the
          timestamp + engineer name and contact{" "}
          <a
            href="mailto:trust@taxottic.com"
            className="underline hover:text-forest-800"
          >
            trust@taxottic.com
          </a>
          . Writes always include a justification, so you can verify
          context without contacting us first.
        </p>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "warn";
}) {
  const dot = tone === "warn" ? "bg-amber-400" : "bg-gold-400";
  return (
    <article className="card p-4 flex items-center gap-3">
      <span aria-hidden="true" className={"size-2.5 rounded-full " + dot} />
      <div>
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

function KindPill({ kind }: { kind: string }) {
  const tones: Record<string, string> = {
    read: "bg-cream-200 text-forest-800 border-forest-200",
    write: "bg-amber-50 text-amber-800 border-amber-200",
  };
  const tone = tones[kind] ?? "bg-cream-100 text-ink-muted border-forest-100";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border ${tone}`}
    >
      {kind}
    </span>
  );
}
