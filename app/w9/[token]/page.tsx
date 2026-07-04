import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/Wordmark";
import { submitW9 } from "./actions";

type Params = Promise<{ token: string }>;

export const metadata = {
  title: "Form W-9, Taxottic",
  description: "Securely complete and sign a Form W-9 for your tax preparer.",
  robots: { index: false, follow: false },
};

const ENTITY_OPTIONS = [
  { value: "individual", label: "Individual / sole proprietor" },
  { value: "c_corp", label: "C Corporation" },
  { value: "s_corp", label: "S Corporation" },
  { value: "partnership", label: "Partnership" },
  { value: "trust_estate", label: "Trust / estate" },
  { value: "llc_c_corp", label: "LLC (taxed as C-Corp)" },
  { value: "llc_s_corp", label: "LLC (taxed as S-Corp)" },
  { value: "llc_partnership", label: "LLC (taxed as Partnership)" },
  { value: "llc_single_member", label: "Single-member LLC (disregarded)" },
  { value: "other", label: "Other" },
];

export default async function W9Page({ params }: { params: Params }) {
  const { token } = await params;
  const admin = createServiceClient();
  const { data: rows } = await admin.rpc("lookup_w9_request", { p_token: token });
  type Row = {
    id: string;
    firm_id: string;
    firm_name: string;
    firm_logo_url: string | null;
    firm_accent_color: string | null;
    recipient_email: string;
    status: string;
    expires_at: string;
  };
  const lookup = (rows as unknown as Row[] | null)?.[0] ?? null;
  if (!lookup) notFound();
  const cta = lookup.firm_accent_color || "#1d2843";

  return (
    <main id="main" className="min-h-screen bg-cream-100 flex items-start justify-center px-4 sm:px-6 py-10">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-6">
          <Wordmark size="md" />
        </div>
        <div className="card p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-4">
            {lookup.firm_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={lookup.firm_logo_url}
                alt={lookup.firm_name}
                className="h-10 w-auto"
              />
            ) : null}
            <div>
              <div
                className="text-[10px] uppercase tracking-[0.2em]"
                style={{ color: cta }}
              >
                {lookup.firm_name} needs your W-9
              </div>
              <h1 className="display text-2xl text-forest-900 leading-tight">
                IRS Form W-9
              </h1>
            </div>
          </div>
          <p className="text-sm text-ink-soft leading-relaxed">
            This form authorizes <strong>{lookup.firm_name}</strong> to
            issue you a Form 1099 at year-end. We need your legal
            name, taxpayer identification number (SSN or EIN), and
            address. The form is signed electronically; your data is
            encrypted in transit and at rest.
          </p>
          {lookup.status === "received" ? (
            <div className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900">
              You&apos;ve already submitted this form. If you need to
              update any fields, you can re-submit below.
            </div>
          ) : null}

          <form action={submitW9} className="mt-6 grid gap-4">
            <input type="hidden" name="token" value={token} />

            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Legal name (as shown on your tax return)
              </span>
              <input
                type="text"
                name="legal_name"
                required
                placeholder="Riley Chen"
                className="input"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Business name (if different)
              </span>
              <input
                type="text"
                name="business_name"
                placeholder="Maple Lane Design Co."
                className="input"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Federal tax classification
              </span>
              <select name="entity_type" required className="input">
                <option value="">Choose…</option>
                {ENTITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-ink-muted leading-relaxed">
                If your LLC is taxed as a corporation, pick the LLC
                variant matching the tax election.
              </span>
            </label>

            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium text-forest-800">
                Address
              </legend>
              <input
                type="text"
                name="address_line_1"
                placeholder="Street address"
                className="input"
              />
              <input
                type="text"
                name="address_line_2"
                placeholder="Apt / suite (optional)"
                className="input"
              />
              <div className="grid grid-cols-[1fr_5rem_6rem] gap-2">
                <input
                  type="text"
                  name="address_city"
                  placeholder="City"
                  className="input"
                />
                <input
                  type="text"
                  name="address_region"
                  placeholder="State"
                  maxLength={3}
                  className="input uppercase"
                />
                <input
                  type="text"
                  name="address_postal_code"
                  placeholder="ZIP"
                  className="input tabular-nums"
                />
              </div>
            </fieldset>

            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium text-forest-800">
                Taxpayer Identification Number (TIN)
              </legend>
              <div className="grid grid-cols-[10rem_1fr] gap-2">
                <select name="tin_type" required className="input">
                  <option value="">Choose…</option>
                  <option value="ssn">SSN</option>
                  <option value="ein">EIN</option>
                </select>
                <input
                  type="text"
                  name="tin_digits"
                  required
                  inputMode="numeric"
                  pattern="[0-9-]{9,11}"
                  placeholder="9 digits"
                  className="input font-mono"
                />
              </div>
              <span className="text-[11px] text-ink-muted leading-relaxed">
                We never display the full TIN. After submission only
                the last 4 digits remain visible.
              </span>
            </fieldset>

            <details className="border border-forest-100 rounded-xl p-3 text-sm">
              <summary className="cursor-pointer font-medium text-forest-800">
                Exempt payee / FATCA codes (rare)
              </summary>
              <div className="mt-3 grid gap-3">
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-forest-800">
                    Exempt payee code
                  </span>
                  <input
                    type="text"
                    name="exempt_payee_code"
                    maxLength={2}
                    className="input"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-forest-800">
                    Exempt FATCA code
                  </span>
                  <input
                    type="text"
                    name="exempt_fatca_code"
                    maxLength={2}
                    className="input"
                  />
                </label>
              </div>
            </details>

            <fieldset className="grid gap-2 border-t border-forest-100 pt-4 mt-2">
              <legend className="text-sm font-medium text-forest-800">
                Signature
              </legend>
              <p className="text-xs text-ink-soft leading-relaxed">
                By typing your full name below you certify, under
                penalties of perjury, that:
              </p>
              <ul className="text-xs text-ink-soft leading-relaxed list-disc pl-5">
                <li>The TIN shown is correct (or you are waiting for one to be issued).</li>
                <li>You are not subject to backup withholding.</li>
                <li>You are a U.S. citizen or other U.S. person.</li>
                <li>The FATCA code(s) entered (if any) are correct.</li>
              </ul>
              <input
                type="text"
                name="signature_full_name"
                required
                placeholder="Type your full name"
                className="input mt-1"
                autoComplete="name"
              />
            </fieldset>

            <button
              type="submit"
              className="btn-primary text-sm mt-1"
              style={{ backgroundColor: cta }}
            >
              Submit W-9
            </button>
            <p className="text-[11px] text-ink-muted leading-relaxed">
              Powered by Taxottic. By submitting you agree that your
              data is shared with {lookup.firm_name} for tax-reporting
              purposes.{" "}
              <Link
                href="https://taxottic.com/legal/privacy"
                className="underline hover:text-forest-800"
                target="_blank"
              >
                Privacy policy
              </Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
