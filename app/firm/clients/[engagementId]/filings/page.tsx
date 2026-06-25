import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import {
  recordFiling,
  updateFilingStatus,
  submitViaMef,
} from "./actions";

type Params = Promise<{ engagementId: string }>;

const FORM_LABEL: Record<string, string> = {
  form_1040: "Form 1040 (Individual)",
  form_1040_x: "Form 1040-X (Amended)",
  form_1065: "Form 1065 (Partnership)",
  form_1120: "Form 1120 (C-Corp)",
  form_1120_s: "Form 1120-S (S-Corp)",
  form_990: "Form 990 (Tax-exempt)",
  form_941: "Form 941 (Quarterly payroll)",
  form_944: "Form 944 (Annual payroll)",
  form_940: "Form 940 (FUTA)",
  form_w2: "W-2 batch",
  form_1099_nec: "1099-NEC batch",
  form_1099_misc: "1099-MISC batch",
  state_income: "State income return",
  state_sales_tax: "State sales-tax return",
  other: "Other filing",
};

const STATUS_TONE: Record<string, string> = {
  prepared: "bg-cream-200 text-forest-800 border-forest-200",
  queued: "bg-gold-50 text-gold-800 border-gold-200",
  submitted: "bg-amber-50 text-amber-800 border-amber-200",
  accepted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  amended: "bg-cream-100 text-ink-muted border-forest-100",
  cancelled: "bg-cream-100 text-ink-muted border-forest-100",
};

export default async function FilingsPage({
  params,
}: {
  params: Params;
}) {
  const { engagementId } = await params;
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const { data: eng } = await admin
    .from("firm_engagements")
    .select("id, tax_year, company:companies!inner(id, name, entity_type)")
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) notFound();
  const company = (
    eng as unknown as {
      company: { id: string; name: string; entity_type: string | null };
    }
  ).company;

  const [{ data: filings }, { data: docs }] = await Promise.all([
    admin
      .from("firm_efilings")
      .select(
        "id, form, status, tax_year, jurisdiction, period_end, submission_target, provider_submission_id, submitted_at, accepted_at, rejected_at, reject_reason, created_at, document_id",
      )
      .eq("firm_id", ctx.firm.id)
      .eq("engagement_id", engagementId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("firm_documents")
      .select("id, kind, filename, tax_year")
      .eq("firm_id", ctx.firm.id)
      .eq("engagement_id", engagementId)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  // Pre-suggest the form type from the company's entity type.
  const defaultForm =
    company.entity_type === "s_corp"
      ? "form_1120_s"
      : company.entity_type === "c_corp"
        ? "form_1120"
        : company.entity_type === "partnership" ||
            company.entity_type === "multi_llc"
          ? "form_1065"
          : "form_1040";

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
          · Filings
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Filing tracker.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-2xl">
          Track every return you file for this client. Direct e-file
          via IRS MeF lands once your firm completes the EFIN +
          ETIN approval; until then, file through the IRS portal or
          your ERO and record the result here.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_22rem]">
          {/* Filing list */}
          <section>
            <h2 className="display text-xl text-forest-900">Filings</h2>
            {(filings ?? []).length === 0 ? (
              <div className="mt-3 card p-6 text-center">
                <p className="text-sm text-ink-soft">
                  No filings recorded yet.
                </p>
              </div>
            ) : (
              <ul className="mt-3 grid gap-3">
                {(filings ?? []).map((f) => (
                  <li key={f.id} className="card p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="display text-base text-forest-900">
                            {FORM_LABEL[f.form] ?? f.form}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border ${
                              STATUS_TONE[f.status] ??
                              "bg-cream-100 text-ink-muted border-forest-100"
                            }`}
                          >
                            {f.status}
                          </span>
                          <span className="text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                            {f.jurisdiction === "federal"
                              ? "Federal"
                              : f.jurisdiction}{" "}
                            · TY {f.tax_year}
                            {f.period_end ? ` · period ${f.period_end}` : ""}
                          </span>
                        </div>
                        {f.provider_submission_id ? (
                          <div className="text-xs text-ink-muted mt-1 font-mono">
                            {f.submission_target ?? "Submission"}:{" "}
                            {f.provider_submission_id}
                          </div>
                        ) : null}
                        {f.reject_reason ? (
                          <div className="text-xs text-red-700 mt-1">
                            Rejected: {f.reject_reason}
                          </div>
                        ) : null}
                        <div className="text-[11px] text-ink-muted mt-1">
                          {f.submitted_at
                            ? `Submitted ${new Date(f.submitted_at).toLocaleDateString()}`
                            : null}
                          {f.accepted_at
                            ? ` · Accepted ${new Date(f.accepted_at).toLocaleDateString()}`
                            : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {f.status === "prepared" || f.status === "queued" ? (
                          <form action={submitViaMef}>
                            <input type="hidden" name="id" value={f.id} />
                            <input
                              type="hidden"
                              name="engagement_id"
                              value={engagementId}
                            />
                            <button className="btn-primary text-xs px-3 h-9">
                              Submit (MeF stub)
                            </button>
                          </form>
                        ) : null}
                        {f.status === "submitted" ? (
                          <>
                            <form action={updateFilingStatus}>
                              <input type="hidden" name="id" value={f.id} />
                              <input
                                type="hidden"
                                name="engagement_id"
                                value={engagementId}
                              />
                              <input
                                type="hidden"
                                name="status"
                                value="accepted"
                              />
                              <button className="btn-primary text-xs px-3 h-9">
                                Mark accepted
                              </button>
                            </form>
                            <form action={updateFilingStatus}>
                              <input type="hidden" name="id" value={f.id} />
                              <input
                                type="hidden"
                                name="engagement_id"
                                value={engagementId}
                              />
                              <input
                                type="hidden"
                                name="status"
                                value="rejected"
                              />
                              <button className="btn-ghost text-xs px-3 h-9 hover:text-red-700">
                                Reject
                              </button>
                            </form>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Record-a-filing form */}
          <aside>
            <form action={recordFiling} className="card p-5 grid gap-3">
              <h2 className="display text-base text-forest-900">
                Record a filing
              </h2>
              <input
                type="hidden"
                name="engagement_id"
                value={engagementId}
              />
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Form
                </span>
                <select
                  name="form"
                  defaultValue={defaultForm}
                  className="input text-sm"
                >
                  {Object.entries(FORM_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-forest-800">
                    Tax year
                  </span>
                  <input
                    type="number"
                    name="tax_year"
                    min={2020}
                    max={2100}
                    defaultValue={eng.tax_year}
                    className="input text-sm tabular-nums"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-forest-800">
                    Jurisdiction
                  </span>
                  <input
                    type="text"
                    name="jurisdiction"
                    defaultValue="federal"
                    maxLength={10}
                    className="input text-sm"
                  />
                  <span className="text-[10px] text-ink-muted">
                    &quot;federal&quot; or a 2-letter state code (CA, NY, …).
                  </span>
                </label>
              </div>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Period end (optional, quarterly only)
                </span>
                <input
                  type="date"
                  name="period_end"
                  className="input text-sm"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Linked document (optional)
                </span>
                <select name="document_id" className="input text-sm">
                  <option value="">None</option>
                  {(docs ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.filename}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Status
                </span>
                <select
                  name="status"
                  className="input text-sm"
                  defaultValue="prepared"
                >
                  <option value="prepared">Prepared (drafted)</option>
                  <option value="submitted">Submitted to authority</option>
                  <option value="accepted">Accepted by authority</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Submission reference (optional)
                </span>
                <input
                  type="text"
                  name="provider_submission_id"
                  placeholder="DCN, ERO acknowledgment, IRS ref"
                  className="input text-sm font-mono"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Preparer PTIN
                </span>
                <input
                  type="text"
                  name="preparer_ptin"
                  placeholder="P12345678"
                  maxLength={10}
                  className="input text-sm font-mono"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Notes (optional)
                </span>
                <textarea name="notes" rows={2} className="input text-sm" />
              </label>
              <button type="submit" className="btn-primary text-sm mt-1">
                Record filing
              </button>
            </form>
          </aside>
        </div>
      </section>
    </main>
  );
}
