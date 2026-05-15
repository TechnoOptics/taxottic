import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { createInvoice, sendInvoice, voidInvoice } from "./actions";

type Params = Promise<{ engagementId: string }>;
type SearchParams = Promise<{ paid?: string; cancelled?: string; invoice?: string }>;

const STATUS_TONE: Record<string, string> = {
  draft: "bg-cream-200 text-forest-800 border-forest-200",
  sent: "bg-gold-50 text-gold-800 border-gold-200",
  viewed: "bg-cream-200 text-forest-800 border-forest-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  voided: "bg-cream-100 text-ink-muted border-forest-100",
  refunded: "bg-amber-50 text-amber-800 border-amber-200",
  failed: "bg-red-50 text-red-700 border-red-200",
};

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { engagementId } = await params;
  const sp = await searchParams;
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const { data: eng } = await admin
    .from("firm_engagements")
    .select("id, tax_year, company:companies!inner(id, name, public_id)")
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) notFound();
  const company = (eng as unknown as { company: { id: string; name: string; public_id: string } }).company;

  const { data: invoices } = await admin
    .from("firm_invoices")
    .select(
      "id, invoice_number, total_cents, currency, status, recipient_email, recipient_name, due_at, created_at, paid_at, stripe_hosted_invoice_url",
    )
    .eq("firm_id", ctx.firm.id)
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false });

  const { data: stripeRow } = await admin
    .from("firm_stripe_accounts")
    .select("charges_enabled")
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  const canSend = Boolean(stripeRow?.charges_enabled);

  // Most-recently-managed contact email for the default recipient.
  const { data: clientMember } = await admin
    .from("company_members")
    .select("profiles!inner(email, full_name)")
    .eq("company_id", (eng as { company_id?: string }).company_id ?? company.id)
    .eq("role", "manager")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const defaultRecipient =
    (clientMember as unknown as { profiles?: { email: string; full_name: string | null } })
      ?.profiles ?? null;

  const yearPart = new Date().getUTCFullYear();
  const seq = String(((invoices ?? []).length + 1)).padStart(3, "0");
  const defaultInvoiceNumber = `INV-${yearPart}-${seq}`;

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
          · Invoices
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Send + collect.
        </h1>

        {sp.paid === "1" ? (
          <div className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm">
            <div className="font-semibold text-emerald-900">
              Payment received.
            </div>
            <div className="mt-1 text-[13px] text-emerald-900/90">
              Funds will settle on your Stripe payout schedule.
            </div>
          </div>
        ) : null}

        {!canSend ? (
          <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm">
            <div className="font-semibold text-amber-900">
              Connect Stripe to send invoices.
            </div>
            <div className="mt-1 text-[13px] text-amber-900/90">
              Drafts can be created without Stripe, but sending +
              accepting payment requires Stripe Connect. Set up under{" "}
              <Link
                href="/firm/settings/payments"
                className="underline hover:text-amber-700"
              >
                Payments settings
              </Link>
              .
            </div>
          </div>
        ) : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_22rem]">
          {/* Invoice list */}
          <section>
            <h2 className="display text-xl text-forest-900">Invoices</h2>
            {(invoices ?? []).length === 0 ? (
              <div className="mt-3 card p-6 text-center">
                <p className="text-sm text-ink-soft">
                  No invoices yet. Draft one in the form on the
                  right.
                </p>
              </div>
            ) : (
              <ul className="mt-3 grid gap-3">
                {(invoices ?? []).map((inv) => (
                  <li key={inv.id} className="card p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="display text-base text-forest-900">
                            {inv.invoice_number}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border ${
                              STATUS_TONE[inv.status] ??
                              "bg-cream-100 text-ink-muted border-forest-100"
                            }`}
                          >
                            {inv.status}
                          </span>
                          <span className="tabular-nums display text-base text-forest-900">
                            {formatCents(inv.total_cents)}
                          </span>
                        </div>
                        <div className="text-xs text-ink-muted mt-0.5">
                          To {inv.recipient_name || inv.recipient_email}{" "}
                          · Drafted{" "}
                          {new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }).format(new Date(inv.created_at))}
                          {inv.due_at
                            ? ` · Due ${new Intl.DateTimeFormat("en-US", {
                                month: "short",
                                day: "numeric",
                              }).format(new Date(inv.due_at))}`
                            : ""}
                          {inv.paid_at
                            ? ` · Paid ${new Intl.DateTimeFormat("en-US", {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              }).format(new Date(inv.paid_at))}`
                            : ""}
                        </div>
                        {inv.stripe_hosted_invoice_url ? (
                          <a
                            href={inv.stripe_hosted_invoice_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-xs underline text-forest-700 hover:text-forest-900"
                          >
                            Hosted invoice ↗
                          </a>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {inv.status === "draft" ? (
                          <form action={sendInvoice}>
                            <input type="hidden" name="invoice_id" value={inv.id} />
                            <input
                              type="hidden"
                              name="engagement_id"
                              value={engagementId}
                            />
                            <button
                              className="btn-primary text-xs px-3 h-9"
                              disabled={!canSend}
                            >
                              Send
                            </button>
                          </form>
                        ) : null}
                        {inv.status === "draft" || inv.status === "sent" ? (
                          <form action={voidInvoice}>
                            <input type="hidden" name="invoice_id" value={inv.id} />
                            <input
                              type="hidden"
                              name="engagement_id"
                              value={engagementId}
                            />
                            <button className="btn-ghost text-xs px-3 h-9 hover:text-red-700">
                              Void
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Draft form */}
          <aside>
            <form
              action={createInvoice}
              className="card p-5 grid gap-3"
            >
              <h2 className="display text-base text-forest-900">
                Draft an invoice
              </h2>
              <input
                type="hidden"
                name="engagement_id"
                value={engagementId}
              />

              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Invoice number
                </span>
                <input
                  type="text"
                  name="invoice_number"
                  defaultValue={defaultInvoiceNumber}
                  className="input text-sm font-mono"
                />
              </label>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-forest-800">
                    Recipient email
                  </span>
                  <input
                    type="email"
                    name="recipient_email"
                    required
                    defaultValue={defaultRecipient?.email ?? ""}
                    className="input text-sm"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-forest-800">
                    Recipient name
                  </span>
                  <input
                    type="text"
                    name="recipient_name"
                    defaultValue={defaultRecipient?.full_name ?? ""}
                    className="input text-sm"
                  />
                </label>
              </div>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Due date (optional)
                </span>
                <input
                  type="date"
                  name="due_at"
                  className="input text-sm"
                />
              </label>

              <div className="grid gap-2">
                <span className="text-xs font-medium text-forest-800">
                  Line items
                </span>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="grid grid-cols-[1fr_5rem_6rem] gap-2">
                    <input
                      type="text"
                      name="line_desc"
                      placeholder={i === 0 ? "Tax preparation — 2026" : "Description"}
                      className="input text-sm"
                    />
                    <input
                      type="number"
                      name="line_qty"
                      min={1}
                      defaultValue={i === 0 ? 1 : ""}
                      placeholder="Qty"
                      className="input text-sm tabular-nums"
                    />
                    <input
                      type="text"
                      name="line_amount"
                      placeholder="$0.00"
                      className="input text-sm tabular-nums"
                    />
                  </div>
                ))}
                <p className="text-[10px] text-ink-muted leading-relaxed">
                  Amounts are per-unit. Add three at a time; multi-line
                  drafting (more rows + tax) ships in Phase 7.5.
                </p>
              </div>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Notes
                </span>
                <textarea name="notes" rows={2} className="input text-sm" />
              </label>

              <button type="submit" className="btn-primary text-sm">
                Save draft
              </button>
            </form>
          </aside>
        </div>
      </section>
    </main>
  );
}

function formatCents(c: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(c / 100);
}
