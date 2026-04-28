import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { US_STATES } from "@/data/us-states";
import { saveTaxProfile } from "./actions";

const FILING_STATUSES = [
  { value: "single", label: "Single" },
  { value: "married_filing_jointly", label: "Married, filing jointly" },
  { value: "married_filing_separately", label: "Married, filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_widow", label: "Qualifying surviving spouse" },
];

export default async function TaxProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { supabase, user } = await requireUser();
  const { next } = await searchParams;
  const taxYear = new Date().getUTCFullYear();

  const { data: existing } = await supabase
    .from("tax_profiles")
    .select(
      "filing_status, state_code, spouse_income_cents, dependents, age, is_blind, itemize, estimated_payments_cents",
    )
    .eq("user_id", user.id)
    .eq("tax_year", taxYear)
    .maybeSingle();

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-2xl mx-auto px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Personal tax profile
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
          A few details so Bella can forecast accurately.
        </h1>
        <p className="mt-3 text-sm text-ink-soft max-w-lg">
          For tax year {taxYear}. You can update these any time. Stored
          privately on your account; only you and super-admins can read them.
        </p>

        <form
          action={async (fd) => {
            "use server";
            await saveTaxProfile(fd, next ?? "/dashboard");
          }}
          className="mt-8 grid gap-6"
        >
          <input type="hidden" name="tax_year" value={taxYear} />

          <Section
            title="Filing status"
            sub="How you'll file your federal return."
          >
            <select
              name="filing_status"
              required
              className="input"
              defaultValue={existing?.filing_status ?? "single"}
            >
              {FILING_STATUSES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Section>

          <Section
            title="State of residence"
            sub="Used for the state-tax estimate."
          >
            <select
              name="state_code"
              className="input"
              defaultValue={existing?.state_code ?? ""}
            >
              <option value="">Select state</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </Section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Section title="Dependents" sub="Number you'll claim.">
              <input
                name="dependents"
                type="number"
                min={0}
                className="input"
                defaultValue={existing?.dependents ?? 0}
              />
            </Section>
            <Section title="Your age" sub="Affects the standard deduction.">
              <input
                name="age"
                type="number"
                min={0}
                max={120}
                className="input"
                defaultValue={existing?.age ?? ""}
                placeholder="e.g. 34"
              />
            </Section>
          </div>

          <Section
            title="Spouse income"
            sub="Annual W-2 or other income for your spouse, if any. Leave at $0 if none."
          >
            <input
              name="spouse_income"
              type="text"
              inputMode="decimal"
              className="input"
              placeholder="$0"
              defaultValue={
                existing?.spouse_income_cents
                  ? (existing.spouse_income_cents / 100).toFixed(0)
                  : ""
              }
            />
          </Section>

          <Section
            title="Estimated payments already made"
            sub="Federal estimated tax (Form 1040-ES) you've sent in for this year."
          >
            <input
              name="estimated_payments"
              type="text"
              inputMode="decimal"
              className="input"
              placeholder="$0"
              defaultValue={
                existing?.estimated_payments_cents
                  ? (existing.estimated_payments_cents / 100).toFixed(0)
                  : ""
              }
            />
          </Section>

          <div className="grid gap-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="is_blind"
                defaultChecked={existing?.is_blind ?? false}
                className="mt-1 size-4 accent-forest-800"
              />
              <span className="text-sm text-ink-soft">
                I qualify as legally blind (additional standard deduction).
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="itemize"
                defaultChecked={existing?.itemize ?? false}
                className="mt-1 size-4 accent-forest-800"
              />
              <span className="text-sm text-ink-soft">
                I plan to itemize deductions instead of taking the standard
                deduction.
              </span>
            </label>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button className="btn-primary">Save and continue</button>
            <a
              href={next ?? "/dashboard"}
              className="btn-ghost"
            >
              Skip for now
            </a>
          </div>
        </form>
      </section>
    </main>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <div>
        <div className="text-sm font-medium text-forest-800">{title}</div>
        {sub ? <div className="text-xs text-ink-muted mt-0.5">{sub}</div> : null}
      </div>
      {children}
    </label>
  );
}
