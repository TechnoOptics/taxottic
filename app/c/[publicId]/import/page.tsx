import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { CsvDropZone } from "@/components/CsvDropZone";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { uploadCsvBatch } from "./actions";

type Params = Promise<{ publicId: string }>;
type SearchParams = Promise<{ error?: string | string[] }>;

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams?: SearchParams;
}) {
  const { publicId } = await params;
  const sp = (await searchParams) ?? {};
  const errRaw = sp.error;
  const errorMessage = Array.isArray(errRaw) ? errRaw[0] : errRaw;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);

  const { data: imports } = await supabase
    .from("bank_imports")
    .select(
      "id, filename, status, row_count, applied_count, account_type, created_at",
    )
    .eq("company_id", company.id)
    .order("created_at", { ascending: false });

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          {company.public_id}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">Bank import</h1>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="import" />
        </div>

        {errorMessage ? (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          >
            {errorMessage}
          </div>
        ) : null}

        <div className="card mt-6 p-6">
          <h2 className="display text-xl text-forest-900">Upload CSVs</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Export transaction CSVs from your bank or card and drop them
            here — you can pick multiple files at once. We&apos;ll
            auto-categorize every row with Bella as soon as each one
            uploads; high-confidence rows apply themselves, the rest land
            on the review page for a one-click confirm. Costs 10 credits
            per import (super admins free).
          </p>
          <div className="mt-5">
            <CsvDropZone companyId={company.id} action={uploadCsvBatch} />
          </div>
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
