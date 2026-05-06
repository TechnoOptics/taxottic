import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { uploadCsv } from "./actions";

type Params = Promise<{ publicId: string }>;

export default async function ImportPage({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);

  const { data: imports } = await supabase
    .from("bank_imports")
    .select(
      "id, filename, status, row_count, applied_count, account_type, created_at",
    )
    .eq("company_id", company.id)
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          {company.public_id}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">Bank import</h1>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="import" />
        </div>

        <div className="card mt-6 p-6">
          <h2 className="display text-xl text-forest-900">Upload a CSV</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Export a transaction CSV from your bank or card and drop it here.
            We&apos;ll auto-categorize every row with Bella as soon as you
            upload — high-confidence rows apply themselves; the rest land on
            the review page for a one-click confirm. Costs 10 credits per
            import (super admins free).
          </p>
          <form
            action={uploadCsv}
            encType="multipart/form-data"
            className="mt-5 grid gap-3"
          >
            <input type="hidden" name="company_id" value={company.id} />

            <label className="grid gap-2">
              <span className="text-sm font-medium text-forest-800">
                What kind of account is this?
              </span>
              <select
                name="account_type"
                required
                defaultValue="business_checking"
                className="input"
              >
                <option value="business_checking">
                  Business checking
                </option>
                <option value="business_savings">Business savings</option>
                <option value="checking">Personal checking</option>
                <option value="savings">Personal savings</option>
                <option value="credit">
                  Credit card (every row counted as an expense)
                </option>
                <option value="other">Other</option>
              </select>
              <span className="text-[11px] text-ink-muted">
                Picking <strong>Credit card</strong> tells us to treat every
                imported row as a business expense — issuers don&apos;t agree
                on charge-vs-payment signs, so we use absolute value and skip
                obvious card payments.
              </span>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-forest-800">
                CSV file
              </span>
              <input
                name="file"
                type="file"
                accept=".csv,text/csv"
                required
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-forest-200 file:bg-white file:px-4 file:py-2 file:text-forest-800 hover:file:bg-cream"
              />
            </label>
            <button className="btn-primary w-full sm:w-auto">
              Upload and parse
            </button>
          </form>
        </div>

        <div className="card mt-6 p-6">
          <h2 className="display text-xl text-forest-900">Past imports</h2>
          <ul className="mt-4 grid gap-2">
            {imports && imports.length > 0 ? (
              imports.map((imp) => (
                <li
                  key={imp.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-forest-100 bg-white/70 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-forest-900 truncate">
                      {imp.filename}
                    </div>
                    <div className="text-xs text-ink-muted mt-0.5">
                      {prettyAccountType(imp.account_type)} ·{" "}
                      {imp.row_count} rows - {imp.applied_count} applied -{" "}
                      <span className="uppercase tracking-wide">
                        {imp.status}
                      </span>{" "}
                      - {new Date(imp.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <Link
                    href={`/c/${publicId}/import/${imp.id}`}
                    className="btn-ghost text-xs px-3 h-9"
                  >
                    Review
                  </Link>
                </li>
              ))
            ) : (
              <li className="py-6 text-sm text-ink-muted">
                No imports yet. Upload one above to get started.
              </li>
            )}
          </ul>
        </div>
      </section>
    </main>
  );
}

function prettyAccountType(t: string | null | undefined): string {
  switch (t) {
    case "business_checking":
      return "Business checking";
    case "business_savings":
      return "Business savings";
    case "checking":
      return "Checking";
    case "savings":
      return "Savings";
    case "credit":
      return "Credit card";
    case "other":
      return "Other";
    default:
      return "Checking";
  }
}
