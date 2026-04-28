import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { formatCents } from "@/lib/tax/forecast";
import { applyTransactions, ignoreTx, setTxCategory } from "../actions";

type Params = Promise<{ publicId: string; importId: string }>;

export default async function ImportReviewPage({ params }: { params: Params }) {
  const { publicId, importId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);

  const { data: imp } = await supabase
    .from("bank_imports")
    .select("id, filename, status, row_count, applied_count, created_at")
    .eq("id", importId)
    .eq("company_id", company.id)
    .single();
  if (!imp) notFound();

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

  const debits = (txs ?? []).filter((t) => t.amount_cents < 0 && !t.ignored);
  const credits = (txs ?? []).filter((t) => t.amount_cents > 0 && !t.ignored);
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
          {imp.row_count} rows uploaded -{" "}
          {imp.applied_count > 0
            ? `${imp.applied_count} applied`
            : "not yet applied"}
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="import" />
        </div>

        {pendingApply.length > 0 ? (
          <form
            action={applyTransactions}
            className="mt-6 card p-5 flex items-center justify-between gap-4 flex-wrap"
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
            <button className="btn-primary">
              Apply {pendingApply.length}
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
                      {t.posted_at ?? "—"}
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
  cats: { code: string; label: string }[];
};

function TxRow({ tx, importId, cats }: TxRowProps) {
  const isApplied = !!tx.applied_expense_id;
  const selected =
    tx.applied_category_code ?? tx.suggested_category_code ?? "";
  const label = cats.find((c) => c.code === selected)?.label;
  return (
    <li className="rounded-lg border border-forest-100 bg-white/70 px-4 py-3 text-sm">
      <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
        <div className="min-w-0 flex-1">
          <div className="text-forest-900 truncate">{tx.description}</div>
          <div className="text-xs text-ink-muted mt-0.5">
            {tx.posted_at ?? "—"}
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
    </li>
  );
}
