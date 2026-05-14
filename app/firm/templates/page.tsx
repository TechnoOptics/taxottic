import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";
import {
  createTemplate,
  pauseTemplate,
  resumeTemplate,
  deleteTemplate,
} from "./actions";

// Tier 2 #2: Recurring invoice templates UI.
//
// Top of page: form to create a new template.
// Bottom of page: list of existing templates with pause/resume/delete.
//
// The cron at /api/cron/firm-invoice-issue mints `firm_invoices`
// rows from each active template whose `next_issue_at` has passed.

export const dynamic = "force-dynamic";

const CADENCE_LABEL: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annually",
};

export default async function FirmTemplatesPage() {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();

  const { data: templatesRaw } = await admin
    .from("firm_invoice_templates")
    .select(
      "id, name, line_items, cadence, issue_day_of_month, active, recipient_email, recipient_name, last_issued_at, next_issue_at, engagement_id, created_at",
    )
    .eq("firm_id", ctx.firm.id)
    .order("created_at", { ascending: false });

  type Tpl = {
    id: string;
    name: string;
    line_items: Array<{
      description: string;
      quantity: number;
      unit_amount_cents: number;
    }>;
    cadence: string;
    issue_day_of_month: number | null;
    active: boolean;
    recipient_email: string;
    recipient_name: string | null;
    last_issued_at: string | null;
    next_issue_at: string | null;
    engagement_id: string | null;
    created_at: string;
  };
  const templates = (templatesRaw ?? []) as unknown as Tpl[];

  // Pull engagement → company names for display.
  const engagementIds = Array.from(
    new Set(templates.map((t) => t.engagement_id).filter((x): x is string => !!x)),
  );
  const { data: engs } = engagementIds.length
    ? await admin
        .from("firm_engagements")
        .select("id, company:companies!inner(name)")
        .in("id", engagementIds)
    : { data: [] };
  const engagementLabel = new Map<string, string>();
  for (const e of (engs ?? []) as unknown as Array<{
    id: string;
    company: { name: string };
  }>) {
    engagementLabel.set(e.id, e.company.name);
  }

  // For the new-template form, list active engagements for the
  // engagement-selector dropdown.
  const { data: activeEngsRaw } = await admin
    .from("firm_engagements")
    .select("id, company:companies!inner(name)")
    .eq("firm_id", ctx.firm.id)
    .eq("status", "active")
    .order("requested_at", { ascending: false });
  const activeEngs = (activeEngsRaw ?? []) as unknown as Array<{
    id: string;
    company: { name: string };
  }>;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          · Recurring invoices
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Recurring invoice templates.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-2xl">
          Define a retainer once and we&apos;ll mint a fresh invoice
          on schedule. The cron runs hourly and creates a draft
          invoice when the next cadence has elapsed — you still get
          to review and send each one from the engagement&apos;s
          invoice page.
        </p>

        <form action={createTemplate} className="card p-5 sm:p-6 mt-6 grid gap-4">
          <h2 className="display text-xl text-forest-900">New template</h2>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-forest-800">
                Template name
              </span>
              <input
                type="text"
                name="name"
                required
                maxLength={200}
                placeholder="Smith Allen — monthly retainer"
                className="input text-sm"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-forest-800">
                Engagement (optional)
              </span>
              <select
                name="engagement_id"
                defaultValue=""
                className="input text-sm"
              >
                <option value="">— Not linked —</option>
                {activeEngs.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.company.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-forest-800">
                Recipient email
              </span>
              <input
                type="email"
                name="recipient_email"
                required
                placeholder="ap@client.com"
                className="input text-sm"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-forest-800">
                Recipient name (optional)
              </span>
              <input
                type="text"
                name="recipient_name"
                maxLength={200}
                placeholder="Smith Allen Partners"
                className="input text-sm"
              />
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-forest-800">
                Cadence
              </span>
              <select
                name="cadence"
                defaultValue="monthly"
                className="input text-sm"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-forest-800">
                Issue day (1-28)
              </span>
              <input
                type="number"
                name="issue_day_of_month"
                required
                min={1}
                max={28}
                defaultValue={1}
                className="input text-sm"
              />
            </label>
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-xs font-medium text-forest-800">
              Line items (at least one)
            </legend>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_5rem_8rem] gap-2 items-end"
              >
                <input
                  type="text"
                  name="line_desc"
                  placeholder={i === 0 ? "Monthly bookkeeping" : ""}
                  maxLength={200}
                  className="input text-sm"
                />
                <input
                  type="number"
                  name="line_qty"
                  placeholder={i === 0 ? "1" : ""}
                  min={1}
                  max={9999}
                  className="input text-sm"
                />
                <input
                  type="text"
                  name="line_amount"
                  placeholder={i === 0 ? "$ 750.00" : ""}
                  className="input text-sm"
                />
              </div>
            ))}
          </fieldset>

          <label className="grid gap-1">
            <span className="text-xs font-medium text-forest-800">
              Notes (optional)
            </span>
            <textarea
              name="notes"
              rows={2}
              maxLength={1000}
              placeholder="Net 15. Includes 1 hour of phone time."
              className="input text-sm"
            />
          </label>

          <div className="flex justify-end">
            <button type="submit" className="btn-primary text-sm">
              Save template
            </button>
          </div>
        </form>

        <section className="mt-8">
          <h2 className="display text-xl text-forest-900">
            Existing templates
          </h2>
          {templates.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              You haven&apos;t created any recurring templates yet.
            </p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {templates.map((t) => {
                const total = t.line_items.reduce(
                  (a, li) => a + li.quantity * li.unit_amount_cents,
                  0,
                );
                return (
                  <li key={t.id} className="card p-4 grid gap-2">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="display text-base text-forest-900">
                          {t.name}
                        </div>
                        <div className="text-xs text-ink-muted mt-0.5">
                          {CADENCE_LABEL[t.cadence] ?? t.cadence}
                          {t.issue_day_of_month
                            ? ` · day ${t.issue_day_of_month}`
                            : ""}
                          {t.engagement_id
                            ? ` · ${engagementLabel.get(t.engagement_id) ?? "—"}`
                            : ""}
                          {" · to "}
                          {t.recipient_name ?? t.recipient_email}
                        </div>
                      </div>
                      <span
                        className={
                          "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border " +
                          (t.active
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-cream-100 text-ink-muted border-forest-100")
                        }
                      >
                        {t.active ? "Active" : "Paused"}
                      </span>
                    </div>
                    <div className="text-xs text-ink-soft">
                      {t.line_items.length} line item
                      {t.line_items.length === 1 ? "" : "s"} · Total{" "}
                      {(total / 100).toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                      })}
                    </div>
                    <div className="text-[11px] text-ink-muted">
                      {t.next_issue_at && t.active
                        ? `Next: ${new Date(t.next_issue_at).toLocaleDateString()}`
                        : t.last_issued_at
                          ? `Last issued ${new Date(t.last_issued_at).toLocaleDateString()}`
                          : "Never issued"}
                    </div>
                    <div className="flex gap-2 mt-1">
                      {t.active ? (
                        <form action={pauseTemplate}>
                          <input type="hidden" name="id" value={t.id} />
                          <button className="btn-ghost text-xs px-3 h-8">
                            Pause
                          </button>
                        </form>
                      ) : (
                        <form action={resumeTemplate}>
                          <input type="hidden" name="id" value={t.id} />
                          <button className="btn-ghost text-xs px-3 h-8">
                            Resume
                          </button>
                        </form>
                      )}
                      <form action={deleteTemplate}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="btn-ghost text-xs px-3 h-8 hover:text-red-700">
                          Delete
                        </button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="mt-8 text-[11px] text-ink-muted max-w-2xl leading-relaxed">
          When the cron fires, new invoices land in draft status on
          the linked engagement&apos;s invoice page. Review and send
          them like any other invoice — Stripe Connect handles the
          payment rail.
        </p>
      </section>
    </main>
  );
}
