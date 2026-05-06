import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { formatCents } from "@/lib/tax/forecast";
import {
  applyTransactions,
  bellaAutoApply,
  deleteImport,
  ignoreTx,
  setTxCategory,
  teachBella,
} from "../actions";
import { isSuperAdmin } from "@/lib/plans/usage";
import { DeleteImportButton } from "@/components/DeleteImportButton";

type Params = Promise<{ publicId: string; importId: string }>;

export default async function ImportReviewPage({ params }: { params: Params }) {
  const { publicId, importId } = await params;
  const { supabase, user, company, isManager } =
    await loadCompanyByPublicId(publicId);
  const superAdmin = await isSuperAdmin(supabase);
  const canDelete = isManager || superAdmin;

  const { data: imp } = await supabase
    .from("bank_imports")
    .select(
      "id, filename, status, row_count, applied_count, account_type, created_at",
    )
    .eq("id", importId)
    .eq("company_id", company.id)
    .single();
  if (!imp) notFound();
  const isCredit = imp.account_type === "credit";

  const [{ data: txs }, { data: categories }] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select(
        "id, description, amount_cents, posted_at, raw_category, suggested_category_code, applied_category_code, applied_expense_id, ignored",
      )
      .eq("import_id", importId)
      .order("posted_at", { ascending: false })
      .order("description"),
    supabase
      .from("deduction_categories")
      .select("code, label")
      .in("scope", ["business", "both"])
      .order("display_order"),
  ]);

  const cats =
    (categories as { code: string; label: string }[] | null) ?? [];

  // For credit-card imports every non-ignored, non-zero row is an
  // expense. For other accounts we keep the conventional debit (out)
  // / credit (in) split.
  const allActive = (txs ?? []).filter((t) => !t.ignored);
  const debits = isCredit
    ? allActive.filter((t) => t.amount_cents !== 0)
    : allActive.filter((t) => t.amount_cents < 0);
  const credits = isCredit
    ? []
    : allActive.filter((t) => t.amount_cents > 0);
  const ignoredRows = (txs ?? []).filter((t) => t.ignored);
  const pendingApply = debits.filter(
    (t) => t.applied_category_code && !t.applied_expense_id,
  );

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-5xl mx-auto px-6 py-10">
        <Link
          href={`/c/${publicId}/import`}
          className="text-sm text-ink-soft hover:text-forest-800"
        >
          &larr; All imports
        </Link>

        <h1 className="display mt-2 text-3xl text-forest-900">
          {imp.filename}
        </h1>
        <div className="text-xs text-ink-muted mt-1 tracking-wide">
          {prettyAccountType(imp.account_type)} ·{" "}
          {imp.row_count} rows uploaded -{" "}
          {imp.applied_count > 0
            ? `${imp.applied_count} applied`
            : "not yet applied"}
        </div>
        {isCredit ? (
          <p className="mt-2 text-xs text-ink-muted max-w-2xl leading-relaxed">
            Credit-card import: every charge counts as an expense regardless
            of CSV sign. We auto-skip rows that look like card payments
            (autopay, payment received, etc.) so they aren&apos;t
            double-counted.
          </p>
        ) : null}

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="import" />
        </div>

        {canDelete ? (
          <DeleteImportButton
            importId={importId}
            companyId={company.id}
            action={deleteImport}
          />
        ) : null}

        <form
          action={bellaAutoApply}
          className="mt-6 card p-5 flex items-center justify-between gap-4 flex-wrap border-gold-300/60"
        >
          <input type="hidden" name="import_id" value={importId} />
          <input type="hidden" name="company_id" value={company.id} />
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
              Bella sorted this for you
            </div>
            <div className="display text-base text-forest-900 mt-1">
              Re-run categorization
            </div>
            <p className="text-xs text-ink-muted mt-1 max-w-xl leading-relaxed">
              Bella already read this import on upload — high-confidence
              rows are applied; lower-confidence rows are below with her
              suggested category. Click to re-run if you added new rows or
              changed the account type. Costs 10 credits; super admins
              free.
            </p>
          </div>
          <button className="btn-ghost">Re-run Bella</button>
        </form>

        {pendingApply.length > 0 ? (
          <form
            action={applyTransactions}
            className="mt-4 card p-5 flex items-center justify-between gap-4 flex-wrap"
          >
            <input type="hidden" name="import_id" value={importId} />
            <input type="hidden" name="company_id" value={company.id} />
            <div>
              <div className="display text-base text-forest-900">
                {pendingApply.length} transaction
                {pendingApply.length === 1 ? "" : "s"} ready to apply
              </div>
              <div className="text-xs text-ink-muted mt-1">
                Each will become a deductible expense entry on the corresponding
                month.
              </div>
            </div>
            <button className="btn-ghost">
              Apply manually selected ({pendingApply.length})
            </button>
          </form>
        ) : null}

        <section className="mt-6 card p-6">
          <h2 className="display text-xl text-forest-900">
            Expense candidates ({debits.length})
          </h2>
          <ul className="mt-4 grid gap-2">
            {debits.length === 0 ? (
              <li className="text-sm text-ink-muted py-4">
                No debit transactions in this file.
              </li>
            ) : (
              debits.map((t) => (
                <TxRow
                  key={t.id}
                  tx={t}
                  importId={importId}
                  companyId={company.id}
                  cats={cats}
                />
              ))
            )}
          </ul>
        </section>

        {credits.length > 0 ? (
          <section className="mt-6 card p-6">
            <h2 className="display text-xl text-forest-900">
              Deposits ({credits.length})
            </h2>
            <p className="text-xs text-ink-muted mt-1">
              Deposits are not auto-applied. Add income manually via the Income
              tab if any of these are taxable revenue (and not transfers or
              refunds).
            </p>
            <ul className="mt-4 grid gap-2">
              {credits.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between rounded-lg border border-forest-100 bg-white/70 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-forest-900 truncate">
                      {t.description}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {t.posted_at ?? "-"}
                    </div>
                  </div>
                  <div className="text-forest-900 tabular-nums font-medium">
                    {formatCents(t.amount_cents)}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {ignoredRows.length > 0 ? (
          <section className="mt-6 card p-6 opacity-60">
            <h2 className="display text-xl text-forest-900">
              Ignored ({ignoredRows.length})
            </h2>
          </section>
        ) : null}
      </section>
    </main>
  );
}

type TxRowProps = {
  tx: {
    id: string;
    description: string;
    amount_cents: number;
    posted_at: string | null;
    raw_category: string | null;
    suggested_category_code: string | null;
    applied_category_code: string | null;
    applied_expense_id: string | null;
    ignored: boolean;
  };
  importId: string;
  companyId: string;
  cats: { code: string; label: string }[];
};

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

function TxRow({ tx, importId, companyId, cats }: TxRowProps) {
  const isApplied = !!tx.applied_expense_id;
  const selected =
    tx.applied_category_code ?? tx.suggested_category_code ?? "";
  const label = cats.find((c) => c.code === selected)?.label;
  // The first 1-3 words of the description make a clean default for
  // the rule pattern — vendor names typically lead the line.
  const defaultPattern = (tx.description ?? "")
    .split(/\s+/)
    .slice(0, 3)
    .join(" ")
    .slice(0, 80);
  return (
    <li className="rounded-lg border border-forest-100 bg-white/70 px-4 py-3 text-sm">
      <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
        <div className="min-w-0 flex-1">
          <div className="text-forest-900 truncate">{tx.description}</div>
          <div className="text-xs text-ink-muted mt-0.5">
            {tx.posted_at ?? "-"}
            {tx.raw_category ? ` - ${tx.raw_category}` : ""}
          </div>
        </div>
        <div className="text-red-800 tabular-nums font-medium shrink-0">
          {formatCents(tx.amount_cents)}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isApplied ? (
          <span className="text-[11px] uppercase tracking-[0.2em] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
            Applied as {label}
          </span>
        ) : (
          <>
            <form action={setTxCategory} className="flex-1 min-w-0">
              <input type="hidden" name="id" value={tx.id} />
              <input type="hidden" name="import_id" value={importId} />
              <select
                name="category_code"
                defaultValue={selected}
                className="input"
              >
                <option value="">Skip / not deductible</option>
                {cats.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button className="hidden">Save</button>
            </form>
            <form action={ignoreTx}>
              <input type="hidden" name="id" value={tx.id} />
              <input type="hidden" name="import_id" value={importId} />
              <button className="text-xs text-ink-muted hover:text-red-700 px-2 py-2">
                Ignore
              </button>
            </form>
          </>
        )}
      </div>

      {/* Teach Bella — collapsed by default, opens an inline form so
          the user can save a rule that fires on every future import. */}
      <details className="mt-2">
        <summary className="text-[11px] text-forest-700 hover:text-forest-900 cursor-pointer select-none inline-flex items-center gap-1">
          <span aria-hidden="true">✦</span> Teach Bella this vendor
        </summary>
        <form
          action={teachBella}
          className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs"
        >
          <input type="hidden" name="company_id" value={companyId} />
          <label className="grid gap-1">
            <span className="text-ink-muted">Match (case-insensitive)</span>
            <input
              name="pattern"
              type="text"
              defaultValue={defaultPattern}
              className="input"
              required
            />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-muted">Match type</span>
            <select name="pattern_type" defaultValue="contains" className="input">
              <option value="contains">Contains</option>
              <option value="starts_with">Starts with</option>
              <option value="exact">Exact</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-muted">Treat as</span>
            <select name="kind" defaultValue="expense" className="input">
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="ignore">Ignore (not deductible)</option>
              <option value="transfer">Transfer (between accounts)</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-muted">Category</span>
            <select
              name="category_code"
              defaultValue={selected}
              className="input"
            >
              <option value="">— pick one —</option>
              {cats.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2 flex items-center gap-3">
            <button className="btn-ghost text-xs">Save rule</button>
            <span className="text-[11px] text-ink-muted">
              Applies to future imports for this company. Re-teaching the same
              pattern updates the existing rule.
            </span>
          </div>
        </form>
      </details>
    </li>
  );
}
