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
import {
  CategoryCombobox,
  type CategoryOption,
} from "@/components/CategoryCombobox";

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
      // Now includes 'personal' so charity / SALT / mortgage-interest
      // / volunteer-mileage are tag-able from a credit-card import
      // (those rows are often mixed in with business charges on the
      // same card). applyTransactions routes personal AND transfer
      // picks via ignored=true so they never inflate the Schedule C
      // deduction — they're labels, not bookings.
      // Pull irc_section + irs_pub so the TxRow can show the
      // citation next to each detected category.
      .select(
        "code, label, scope, schedule_c_line, irc_section, irs_pub, irs_url",
      )
      .in("scope", ["business", "both", "transfer", "personal"])
      .order("display_order"),
  ]);

  const cats =
    (categories as {
      code: string;
      label: string;
      scope: string;
      schedule_c_line: string | null;
      irc_section: string | null;
      irs_pub: string | null;
      irs_url: string | null;
    }[] | null) ?? [];
  // Build the option list once with schedule_c_line surfaced as the
  // small hint label on the right edge of each combobox row.
  const catOptions: CategoryOption[] = cats.map((c) => ({
    code: c.code,
    label: c.label,
    hint: c.schedule_c_line,
    scope: c.scope,
  }));
  // Lookup so the TxRow can render the IRC / Pub citation next to
  // the chosen category without re-fetching.
  const catById = new Map<
    string,
    {
      label: string;
      scope: string;
      schedule_c_line: string | null;
      irc_section: string | null;
      irs_pub: string | null;
      irs_url: string | null;
    }
  >();
  for (const c of cats) {
    catById.set(c.code, {
      label: c.label,
      scope: c.scope,
      schedule_c_line: c.schedule_c_line,
      irc_section: c.irc_section,
      irs_pub: c.irs_pub,
      irs_url: c.irs_url,
    });
  }

  // Most-used category codes for THIS company — used to bubble
  // already-frequent picks to the top of the searchable list (and
  // gold-star them when the query is empty). Cheap query: a single
  // GROUP BY + ORDER BY count desc + LIMIT 8. Limit 6 months back so
  // an old habit doesn't permanently anchor the order.
  // eslint-disable-next-line react-hooks/purity -- server component, evaluated per-request
  const sixMoAgo = new Date(Date.now() - 180 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { data: freqRows } = await supabase
    .from("monthly_expenses")
    .select("category_code")
    .eq("company_id", company.id)
    .gte("created_at", sixMoAgo);
  const freqCounts = new Map<string, number>();
  for (const r of (freqRows ?? []) as { category_code: string | null }[]) {
    if (!r.category_code) continue;
    freqCounts.set(r.category_code, (freqCounts.get(r.category_code) ?? 0) + 1);
  }
  const frequentCodes = Array.from(freqCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([code]) => code);

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

  // Bella detection rollup — shown at the top of the review section
  // so the user can see at a glance "Bella tagged X, you tagged Y,
  // these N are still untouched." Computed from in-memory debits
  // (already loaded above) — no extra round-trip.
  const stats = {
    total: debits.length,
    appliedAsExpense: debits.filter((t) => t.applied_expense_id).length,
    bellaSuggested: debits.filter(
      (t) =>
        t.suggested_category_code &&
        !t.applied_category_code &&
        !t.applied_expense_id,
    ).length,
    userTagged: debits.filter(
      (t) => t.applied_category_code && !t.applied_expense_id,
    ).length,
    untouched: debits.filter(
      (t) =>
        !t.suggested_category_code &&
        !t.applied_category_code &&
        !t.applied_expense_id,
    ).length,
  };

  // Group debits by calendar month (posted_at "YYYY-MM-DD" → "YYYY-MM").
  // Keeps the review legible on multi-month statements (Amex, year-end
  // dumps) which the user reported as "please group imported csv
  // into months." Rows without a posted_at fall into "No date" at
  // the end of the list so they're never silently dropped.
  type Debit = (typeof debits)[number];
  const monthMap = new Map<string, Debit[]>();
  for (const t of debits) {
    const key = t.posted_at ? t.posted_at.slice(0, 7) : "unknown";
    const arr = monthMap.get(key) ?? [];
    arr.push(t);
    monthMap.set(key, arr);
  }
  const debitGroups = Array.from(monthMap.entries())
    .sort((a, b) => {
      if (a[0] === "unknown") return 1;
      if (b[0] === "unknown") return -1;
      return b[0].localeCompare(a[0]); // newest month first
    })
    .map(([key, rows]) => ({
      key,
      label:
        key === "unknown"
          ? "No date"
          : new Date(key + "-15T00:00:00Z").toLocaleString(undefined, {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            }),
      rows,
      totalCents: rows.reduce((a, r) => a + Math.abs(r.amount_cents), 0),
    }));

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 py-10">
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

        {/* Bella detection rollup — surfaces "what did the model see"
            and "what was applied" without making the user count rows
            manually. The deduction IRC / Pub citation for each picked
            category appears next to the row below. */}
        <section className="mt-6 card p-5">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
                Bella&apos;s pass over this import
              </div>
              <div className="display text-lg text-forest-900 mt-1">
                {stats.total} expense candidates
              </div>
            </div>
            <div className="text-[11px] text-ink-muted leading-relaxed text-right">
              {stats.appliedAsExpense > 0 ? (
                <span className="block text-emerald-700">
                  ✓ {stats.appliedAsExpense} already booked as expenses
                </span>
              ) : null}
              {stats.userTagged > 0 ? (
                <span className="block text-forest-800">
                  • {stats.userTagged} tagged, ready to apply
                </span>
              ) : null}
              {stats.bellaSuggested > 0 ? (
                <span className="block text-gold-800">
                  ⚡ {stats.bellaSuggested} pre-tagged by Bella for review
                </span>
              ) : null}
              {stats.untouched > 0 ? (
                <span className="block text-rose-800">
                  ? {stats.untouched} still untouched
                </span>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mt-6 card p-6">
          <h2 className="display text-xl text-forest-900">
            Expense candidates ({debits.length})
          </h2>
          {debits.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              No debit transactions in this file.
            </p>
          ) : (
            <div className="mt-4 grid gap-6">
              {debitGroups.map((g) => (
                <div key={g.key}>
                  <h3 className="text-[11px] uppercase tracking-[0.22em] text-gold-700 flex items-baseline gap-2">
                    <span>{g.label}</span>
                    <span className="text-ink-muted normal-case tracking-normal">
                      {g.rows.length}{" "}
                      {g.rows.length === 1 ? "row" : "rows"} ·{" "}
                      {formatCents(g.totalCents)}
                    </span>
                  </h3>
                  <ul className="mt-2 grid gap-2">
                    {g.rows.map((t) => (
                      <TxRow
                        key={t.id}
                        tx={t}
                        importId={importId}
                        companyId={company.id}
                        cats={catOptions}
                        frequentCodes={frequentCodes}
                        catById={catById}
                        isCredit={isCredit}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
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
  cats: CategoryOption[];
  frequentCodes: string[];
  /** Credit-card flag — flips the amount display: on a card, a
   *  NEGATIVE CSV row is money coming back (refund or balance
   *  payment from another account). User feedback: "if something
   *  has a negative sign on it, when dealing with a credit card,
   *  the amount should be green ... a debit acts like a credit
   *  and a credit acts like a debit." */
  isCredit?: boolean;
  /** Lookup keyed by category code → full row including the IRC /
   *  Pub citations. Lets the row render "Sec 162 · Pub 535" next to
   *  the picked category without re-fetching. */
  catById: Map<
    string,
    {
      label: string;
      scope: string;
      schedule_c_line: string | null;
      irc_section: string | null;
      irs_pub: string | null;
      irs_url: string | null;
    }
  >;
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

function TxRow({
  tx,
  importId,
  companyId,
  cats,
  frequentCodes,
  catById,
  isCredit,
}: TxRowProps) {
  const isApplied = !!tx.applied_expense_id;
  const selected =
    tx.applied_category_code ?? tx.suggested_category_code ?? "";
  const label = cats.find((c) => c.code === selected)?.label;
  // Citation strip — show Schedule C line, IRC §, and IRS Pub for
  // the chosen category. Skipped for transfer-scoped picks (those
  // aren't deductions). User feedback explicitly asked for "the
  // relevant IRC."
  const cat = selected ? catById.get(selected) ?? null : null;
  const isTransfer = cat?.scope === "transfer";
  const citationParts: string[] = [];
  if (cat && !isTransfer) {
    if (cat.schedule_c_line) citationParts.push(`Sched C ${cat.schedule_c_line}`);
    if (cat.irc_section) citationParts.push(`IRC §${cat.irc_section}`);
    if (cat.irs_pub) citationParts.push(cat.irs_pub);
  }
  const wasBellaSuggested =
    !!tx.suggested_category_code && !tx.applied_category_code && !isApplied;
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
        {/* Amount display, sign-aware for credit cards.
            Credit-card sign convention is INVERTED vs checking:
              negative on the CSV = money coming BACK to the user
              (refund, payment-back from another account) → GREEN +
              positive on the CSV = real charge, money OUT → RED.
            Checking/savings keep the conventional red for outflows. */}
        {(() => {
          const isMoneyBack = !!isCredit && tx.amount_cents < 0;
          if (isMoneyBack) {
            return (
              <div className="text-emerald-700 tabular-nums font-medium shrink-0">
                +{formatCents(Math.abs(tx.amount_cents))}
              </div>
            );
          }
          return (
            <div className="text-rose-800 tabular-nums font-medium shrink-0">
              {formatCents(tx.amount_cents)}
            </div>
          );
        })()}
      </div>

      {/* Bella detection chip + IRC citation. Shown above the
          picker so the user reads "what Bella thinks this is +
          which Schedule C line + which IRC §" before clicking
          anything. Skipped for transfer-scoped picks (those
          aren't deductions). */}
      {selected && cat ? (
        <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
          {wasBellaSuggested ? (
            <span className="inline-flex items-center gap-1 text-gold-800 bg-gold-50 border border-gold-200 rounded-full px-2 py-0.5">
              <span aria-hidden="true">⚡</span>
              <span>Bella suggested</span>
            </span>
          ) : null}
          {isTransfer ? (
            <span className="uppercase tracking-[0.18em] text-ink-muted">
              transfer · not a deduction
            </span>
          ) : citationParts.length > 0 ? (
            <span className="text-ink-soft">
              {citationParts.map((p, i) => (
                <span key={p}>
                  {i > 0 ? " · " : ""}
                  {p}
                </span>
              ))}
              {cat.irs_url ? (
                <>
                  {" · "}
                  <a
                    href={cat.irs_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
                  >
                    irs.gov ↗
                  </a>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

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
              {/* Searchable combobox — type to filter the full list,
                  or open and scroll. Auto-submits the form when a
                  pick is made, matching the prior native-select UX. */}
              <CategoryCombobox
                name="category_code"
                defaultValue={selected}
                options={cats}
                frequentCodes={frequentCodes}
                placeholder="Pick a category…"
              />
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
          {/* Scope the retro-apply to THIS import. teachBella looks
              up all other matching rows in the same batch and pre-
              tags them so the user doesn't have to repeat the
              training for every duplicate. */}
          <input type="hidden" name="import_id" value={importId} />
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
            {/* Same searchable combobox in the Teach Bella form. We
                don't auto-submit here because the form has more
                fields the user still needs to set. */}
            <CategoryCombobox
              name="category_code"
              defaultValue={selected}
              options={cats}
              frequentCodes={frequentCodes}
              placeholder="— pick one —"
              autoSubmit={false}
              emptyLabel="— pick one —"
            />
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
