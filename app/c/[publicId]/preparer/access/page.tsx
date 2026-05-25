import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";

type Params = Promise<{ publicId: string }>;

/**
 * Transparency view: for every active engagement on this company,
 * show the user EXACTLY which data fields the firm can read and
 * which stay private. The shared list is curated to match the SELECT
 * RLS policies that fired for `firm_has_active_engagement_with`.
 *
 * This is a trust feature, not a control surface. End-engagement is
 * one click away on /preparer; here we just make the access bargain
 * legible.
 */

const SHARED_GROUPS = [
  {
    title: "Company basics",
    rows: [
      { label: "Legal name + DBA" },
      { label: "Public company ID (co_*)" },
      { label: "Entity type (LLC, S-Corp, etc.)" },
      { label: "State of incorporation" },
      { label: "Logo and branding" },
    ],
  },
  {
    title: "Business profile (for the engaged tax year)",
    rows: [
      { label: "EIN, legal name, address, phone, business email" },
      { label: "Primary industry" },
      { label: "Whether you have W-2 employees + headcount" },
      { label: "Vehicle method, business miles" },
      { label: "Home-office presence + sq ft" },
    ],
  },
  {
    title: "Books for the engaged tax year",
    rows: [
      { label: "Every income entry (month, source, amount, notes, recurrence)" },
      { label: "Every expense entry (month, category, amount, notes, recurrence)" },
      { label: "Auto-applied mileage and home-office deductions" },
      { label: "Year-end forecast snapshot" },
    ],
  },
  {
    title: "Personal tax profile (manager only)",
    rows: [
      {
        label:
          "Filing status, state, age, blind, dependents, itemize, dependents under 17",
      },
      {
        label:
          "Owner W-2 wages + withholding + Social Security wages",
      },
      {
        label:
          "Spouse W-2 wages + withholding + Social Security wages",
      },
      { label: "Estimated tax payments already made" },
    ],
  },
];

const PRIVATE_GROUPS = [
  {
    title: "Other companies you own",
    rows: [
      {
        label:
          "Each engagement is scoped to one company at a time. The firm cannot see other companies on your account.",
      },
    ],
  },
  {
    title: "Other tax years",
    rows: [
      {
        label:
          "Engagements are scoped to a specific tax year. Books from prior or future years stay private.",
      },
    ],
  },
  {
    title: "Account & login",
    rows: [
      { label: "Password, passkeys, sign-in history, two-factor settings" },
      { label: "Billing details, subscription history, payment methods" },
      { label: "Bella conversation history" },
      { label: "Goals, reminders, achievements" },
    ],
  },
  {
    title: "Other team members on this company",
    rows: [
      {
        label:
          "Member emails appear, but their personal tax profiles (W-2 wages, dependents, withholding) are not visible to the firm.",
      },
    ],
  },
];

const ACTIONS_FIRM_CAN_TAKE = [
  "Read your books for the engaged tax year",
  "Open audit cases on their side and attach IRS letters",
  "Add internal notes for their staff (private to them)",
];

const ACTIONS_FIRM_CANNOT_TAKE = [
  "Edit, delete, or add any income or expense entry on your books",
  "Change your business profile, tax profile, or any account setting",
  "Sign in as you or post messages on your behalf",
  "Access your books from before the engagement was accepted",
  "Continue accessing your books after you end the engagement",
];

export default async function AccessTransparencyPage({
  params,
}: {
  params: Params;
}) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);

  // Pull active engagements with the firm join so we can name names.
  const { data: rows } = await supabase
    .from("firm_engagements")
    .select(
      "id, tax_year, kind, status, firm:firms(public_id, name, logo_url, accent_color, status)",
    )
    .eq("company_id", company.id)
    .eq("status", "active")
    .order("tax_year", { ascending: false });

  type FirmRow = {
    public_id: string;
    name: string;
    logo_url: string | null;
    accent_color: string | null;
    status: string;
  };
  const active = ((rows ?? []) as unknown as Array<{
    id: string;
    tax_year: number;
    kind: string;
    status: string;
    firm: FirmRow | FirmRow[] | null;
  }>).map((e) => ({
    ...e,
    firm: (Array.isArray(e.firm) ? e.firm[0] : e.firm) ?? null,
  }));

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 py-10">
        <Link
          href={`/c/${publicId}/preparer`}
          className="text-xs text-ink-soft hover:text-forest-900"
        >
          ← Tax preparer
        </Link>
        <div className="mt-3 text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.public_id} <span className="text-gold-700">·</span>{" "}
          Access transparency
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Exactly what your preparer can see.
        </h1>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>
        <p className="mt-5 text-sm text-ink-soft leading-relaxed max-w-2xl">
          You decide who prepares your taxes, and the data they see is
          scoped to that decision. This page lists the exact rows we
          unlock for each firm with an active engagement on{" "}
          <span className="text-forest-800 font-medium">{company.name}</span>,
          and what we keep private no matter what. End an engagement on
          the previous page and access cuts off on the next request.
        </p>

        {active.length === 0 ? (
          <div className="card mt-6 p-7">
            <h2 className="display text-xl text-forest-900">
              No active engagements.
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              No firm is currently engaged on this company, so nothing is
              being shared. The bargains below kick in only after you
              accept a firm.
            </p>
          </div>
        ) : (
          <section className="mt-6 grid gap-3">
            {active.map((e) => (
              <article
                key={e.id}
                className="card p-5 flex items-center gap-4 flex-wrap"
              >
                {e.firm?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={e.firm.logo_url}
                    alt=""
                    className="size-12 rounded-xl border border-forest-100 bg-white object-contain p-1.5"
                  />
                ) : (
                  <span className="size-12 rounded-xl bg-cream/70 border border-forest-100 grid place-items-center display text-xl text-forest-900">
                    {(e.firm?.name ?? "?").charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="display text-base text-forest-900 truncate">
                    {e.firm?.name ?? "Unknown firm"}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {e.firm?.public_id} · tax year {e.tax_year} · {e.kind}
                  </div>
                </div>
                <Link
                  href={`/c/${publicId}/preparer`}
                  className="text-xs text-ink-muted hover:text-red-700"
                >
                  End engagement
                </Link>
              </article>
            ))}
          </section>
        )}

        {/* Shared */}
        <section className="mt-10">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="inline-grid place-items-center size-7 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800"
            >
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 8 L7 12 L13 4" />
              </svg>
            </span>
            <h2 className="display text-2xl text-forest-900">
              What the firm can see
            </h2>
          </div>
          <ul className="mt-4 grid gap-3">
            {SHARED_GROUPS.map((g) => (
              <li key={g.title} className="card p-5">
                <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
                  {g.title}
                </div>
                <ul className="mt-2 grid gap-1.5">
                  {g.rows.map((r) => (
                    <li
                      key={r.label}
                      className="flex items-start gap-2 text-sm text-ink-soft leading-relaxed"
                    >
                      <span className="mt-1 inline-block size-1.5 rounded-full bg-emerald-600 shrink-0" />
                      <span>{r.label}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        {/* Private */}
        <section className="mt-10">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="inline-grid place-items-center size-7 rounded-full bg-forest-50 border border-forest-200 text-forest-800"
            >
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <rect x="4" y="7" width="8" height="6" rx="1" />
                <path d="M6 7 V5 a2 2 0 0 1 4 0 V7" />
              </svg>
            </span>
            <h2 className="display text-2xl text-forest-900">
              What stays private
            </h2>
          </div>
          <ul className="mt-4 grid gap-3">
            {PRIVATE_GROUPS.map((g) => (
              <li key={g.title} className="card p-5">
                <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
                  {g.title}
                </div>
                <ul className="mt-2 grid gap-1.5">
                  {g.rows.map((r) => (
                    <li
                      key={r.label}
                      className="flex items-start gap-2 text-sm text-ink-soft leading-relaxed"
                    >
                      <span className="mt-1 inline-block size-1.5 rounded-full bg-forest-700 shrink-0" />
                      <span>{r.label}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        {/* Capabilities */}
        <section className="mt-10 grid sm:grid-cols-2 gap-4">
          <div className="card p-5">
            <div className="text-[10px] uppercase tracking-[0.28em] text-emerald-800 font-medium">
              The firm CAN
            </div>
            <ul className="mt-3 grid gap-1.5">
              {ACTIONS_FIRM_CAN_TAKE.map((a) => (
                <li
                  key={a}
                  className="flex items-start gap-2 text-sm text-ink-soft leading-relaxed"
                >
                  <span className="mt-1 inline-block size-1.5 rounded-full bg-emerald-600 shrink-0" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-5 border-red-100">
            <div className="text-[10px] uppercase tracking-[0.28em] text-red-800 font-medium">
              The firm CANNOT
            </div>
            <ul className="mt-3 grid gap-1.5">
              {ACTIONS_FIRM_CANNOT_TAKE.map((a) => (
                <li
                  key={a}
                  className="flex items-start gap-2 text-sm text-ink-soft leading-relaxed"
                >
                  <span className="mt-1 inline-block size-1.5 rounded-full bg-red-600 shrink-0" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <p className="mt-12 text-[11px] leading-relaxed text-ink-muted max-w-2xl">
          Access is enforced at the database row-level via{" "}
          <code className="bg-cream/70 border border-forest-100 rounded px-1 py-0.5 text-[10px]">
            firm_has_active_engagement_with(company_id)
          </code>
          . The moment you end the engagement, the next read attempt
          from the firm is rejected by the database itself, not the app.
          No queue, no cleanup window.
        </p>
      </section>
    </main>
  );
}
