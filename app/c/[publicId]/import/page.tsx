import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { CsvDropZone } from "@/components/CsvDropZone";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { isSuperAdmin } from "@/lib/plans/usage";
import { uploadCsvBatch } from "./actions";
import { summarizeImport, summarizeImports } from "@/lib/csv/import-summary";

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
  const { supabase, user, company, isManager } =
    await loadCompanyByPublicId(publicId);
  // Uploading stays open to any member (the plan meters it per user),
  // but "Past imports" is not a company-wide list: a manager or super
  // admin reconciles everything, everyone else sees only their own.
  const canReadAnyImport = isManager || (await isSuperAdmin(supabase));

  // Filtered here as well as in RLS on purpose. The policy is the real
  // boundary; this makes the intent legible at the call site and keeps
  // the page correct on its own if the policy is ever relaxed again.
  let importsQuery = supabase
    .from("bank_imports")
    .select(
      "id, filename, status, row_count, applied_count, account_type, created_at",
    )
    .eq("company_id", company.id);
  if (!canReadAnyImport) importsQuery = importsQuery.eq("user_id", user.id);
  const { data: imports } = await importsQuery.order("created_at", {
    ascending: false,
  });

  // One query for every row this company has imported, tallied per
  // import. This list used to render bank_imports.applied_count
  // verbatim, and that column reads 0 on an import with 48 booked rows:
  // four code paths write it and the upload-time auto-categorize that
  // books most rows is not one of them. Deriving it costs one round
  // trip and cannot drift.
  const { data: allRows } = await supabase
    .from("bank_transactions")
    .select("import_id, applied_expense_id, applied_income_id, ignored")
    .eq("company_id", company.id);
  const summaries = summarizeImports(
    (allRows ?? []).map((r) => ({
      importId: r.import_id as string,
      appliedExpenseId: r.applied_expense_id as string | null,
      appliedIncomeId: r.applied_income_id as string | null,
      ignored: !!r.ignored,
    })),
  );
  const empty = summarizeImport([]);
  // Completed imports collapse out of the active list rather than
  // disappearing: reopening is a status change, so hiding them entirely
  // would make a reversible action feel destructive.
  const active = (imports ?? []).filter((i) => i.status !== "complete");
  const completed = (imports ?? []).filter((i) => i.status === "complete");

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          {company.name}
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
            here, you can pick multiple files at once. We&apos;ll
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
            {active.length > 0 ? (
              active.map((imp) => (
                <ImportListRow
                  key={imp.id}
                  imp={imp}
                  publicId={publicId}
                  summary={summaries.get(imp.id) ?? empty}
                />
              ))
            ) : (
              <li className="py-6 text-sm text-ink-muted">
                {completed.length > 0
                  ? "Nothing left to review. Completed imports are below."
                  : "No imports yet. Upload one above to get started."}
              </li>
            )}
          </ul>
        </div>

        {completed.length > 0 ? (
          <div className="card mt-6 p-6">
            <details>
              <summary className="cursor-pointer select-none flex items-baseline justify-between gap-3 flex-wrap">
                <h2 className="display text-xl text-forest-900">
                  Completed ({completed.length})
                </h2>
                <span className="text-xs text-ink-muted">
                  Click to review or reopen
                </span>
              </summary>
              <ul className="mt-4 grid gap-2">
                {completed.map((imp) => (
                  <ImportListRow
                    key={imp.id}
                    imp={imp}
                    publicId={publicId}
                    summary={summaries.get(imp.id) ?? empty}
                  />
                ))}
              </ul>
            </details>
          </div>
        ) : null}
      </section>
    </main>
  );
}

/**
 * One import in the list. Every number here comes from the summary,
 * never from imp.applied_count, and the status word shown is the
 * derived state rather than the stored one wherever they can disagree.
 */
function ImportListRow({
  imp,
  publicId,
  summary,
}: {
  imp: {
    id: string;
    filename: string;
    status: string;
    account_type: string | null;
    created_at: string;
  };
  publicId: string;
  summary: ReturnType<typeof summarizeImport>;
}) {
  const state =
    imp.status === "complete"
      ? "complete"
      : summary.unresolved > 0
        ? `${summary.unresolved} to review`
        : "ready to complete";
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-forest-100 bg-white/70 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-forest-900 truncate">
          {imp.filename}
        </div>
        <div className="text-xs text-ink-muted mt-0.5">
          {prettyAccountType(imp.account_type)} · {summary.total} rows -{" "}
          {summary.applied} applied -{" "}
          <span className="uppercase tracking-wide">{state}</span> -{" "}
          {new Date(imp.created_at).toLocaleDateString()}
        </div>
      </div>
      <Link
        href={`/c/${publicId}/import/${imp.id}`}
        className="btn-ghost text-xs px-3 h-9"
      >
        Review
      </Link>
    </li>
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
