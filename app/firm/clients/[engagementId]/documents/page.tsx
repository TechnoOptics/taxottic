import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import {
  generateEngagementLetter,
  generateScheduleCDraft,
  archiveDocument,
} from "./actions";

// /firm/clients/{engagementId}/documents — every doc on this
// engagement. Two columns: the action panel (generate / upload /
// send for signature) and the document list.

type Params = Promise<{ engagementId: string }>;

const KIND_LABEL: Record<string, string> = {
  engagement_letter: "Engagement letter",
  organizer: "Tax organizer",
  invoice: "Invoice",
  receipt: "Receipt",
  firm_letter: "Firm letter",
  internal_memo: "Internal memo",
  schedule_c_draft: "Schedule C (draft)",
  schedule_e_draft: "Schedule E (draft)",
  k1_draft: "Schedule K-1 (draft)",
  "1099_nec_draft": "Form 1099-NEC (draft)",
  "1099_misc_draft": "Form 1099-MISC (draft)",
  "1040_draft": "Form 1040 (draft)",
  tax_return_packet: "Return packet",
  client_upload_w2: "Client W-2",
  client_upload_1099: "Client 1099",
  client_upload_receipt: "Client receipt",
  client_upload_prior_return: "Prior return",
  client_upload_other: "Client upload",
  manual_upload: "Upload",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  ready_for_review: "Ready for review",
  awaiting_signature: "Awaiting signature",
  signed: "Signed",
  filed: "Filed",
  sent_to_client: "Sent to client",
  archived: "Archived",
  error: "Error",
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-cream-200 text-forest-800 border-forest-200",
  ready_for_review: "bg-amber-50 text-amber-800 border-amber-200",
  awaiting_signature: "bg-gold-50 text-gold-800 border-gold-200",
  signed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  filed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  sent_to_client: "bg-cream-100 text-forest-800 border-forest-100",
  archived: "bg-cream-100 text-ink-muted border-forest-100",
  error: "bg-red-50 text-red-700 border-red-200",
};

export default async function DocumentsPage({
  params,
}: {
  params: Params;
}) {
  const { engagementId } = await params;
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const { data: eng } = await admin
    .from("firm_engagements")
    .select(
      "id, firm_id, tax_year, kind, company:companies!inner(id, name, public_id)",
    )
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) notFound();
  const company = (eng as unknown as { company: { id: string; name: string; public_id: string } }).company;

  const { data: docs } = await admin
    .from("firm_documents")
    .select(
      "id, kind, status, provider, provider_envelope_id, filename, content_type, size_bytes, tax_year, created_at, signed_at, filed_at, sent_at",
    )
    .eq("firm_id", ctx.firm.id)
    .eq("engagement_id", engagementId)
    .neq("status", "archived")
    .order("created_at", { ascending: false });

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
          ·{" "}
          <Link
            href={`/firm/clients/${engagementId}`}
            className="underline decoration-dotted hover:text-forest-900"
          >
            {company.name}
          </Link>{" "}
          · Documents
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Documents for tax year {eng.tax_year}.
        </h1>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_18rem]">
          {/* Document list */}
          <section>
            <h2 className="display text-xl text-forest-900">All documents</h2>
            {(docs ?? []).length === 0 ? (
              <div className="mt-3 card p-6 text-center">
                <p className="text-sm text-ink-soft">
                  No documents yet. Generate an engagement letter to
                  get started.
                </p>
              </div>
            ) : (
              <ul className="mt-3 grid gap-3">
                {(docs ?? []).map((d) => (
                  <li key={d.id} className="card p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="display text-base text-forest-900">
                            {KIND_LABEL[d.kind] ?? d.kind}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border ${
                              STATUS_TONE[d.status] ??
                              "bg-cream-100 text-ink-muted border-forest-100"
                            }`}
                          >
                            {STATUS_LABEL[d.status] ?? d.status}
                          </span>
                          {d.provider !== "manual" &&
                          d.provider !== "generated" ? (
                            <span className="text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                              via {d.provider}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-ink-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>{d.filename}</span>
                          <span>·</span>
                          <span>{formatBytes(d.size_bytes ?? 0)}</span>
                          <span>·</span>
                          <span>
                            Created{" "}
                            {new Intl.DateTimeFormat("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }).format(new Date(d.created_at))}
                          </span>
                        </div>
                      </div>
                      <form action={archiveDocument}>
                        <input type="hidden" name="id" value={d.id} />
                        <input
                          type="hidden"
                          name="engagement_id"
                          value={engagementId}
                        />
                        <button className="btn-ghost text-xs px-3 h-9 hover:text-red-700">
                          Archive
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Generate panel */}
          <aside className="grid gap-4">
            <div className="card p-4">
              <h2 className="display text-base text-forest-900">
                Generate
              </h2>
              <p className="mt-1 text-xs text-ink-soft leading-relaxed">
                Auto-populated from the engagement metadata + firm
                profile.
              </p>
              <form action={generateEngagementLetter} className="mt-3">
                <input
                  type="hidden"
                  name="engagement_id"
                  value={engagementId}
                />
                <button className="btn-primary text-sm w-full">
                  Engagement letter
                </button>
              </form>
              <form action={generateScheduleCDraft} className="mt-2">
                <input
                  type="hidden"
                  name="engagement_id"
                  value={engagementId}
                />
                <button className="btn-ghost text-sm w-full">
                  Schedule C draft
                </button>
              </form>
              <p className="mt-3 text-[11px] text-ink-muted leading-relaxed">
                Schedule C reads YTD income + expenses, maps each
                category to the IRS line, and applies the 50% meals
                limit. Sole-prop / single-member-LLC only. K-1 /
                1099 generators ship next.
              </p>
            </div>

            <div className="card p-4 opacity-90">
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
                Phase 5.5
              </div>
              <h3 className="display text-base text-forest-900 mt-1">
                E-signature
              </h3>
              <p className="mt-1 text-xs text-ink-soft leading-relaxed">
                Send drafts for signature via Documenso (default) or
                DocuSign (enterprise tier). Webhook updates status
                on signature.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
