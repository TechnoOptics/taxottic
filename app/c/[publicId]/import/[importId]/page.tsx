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
import { type CategoryOption } from "@/components/CategoryCombobox";
import { TxRow } from "@/components/import/TxRow";

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

  // Split debits into "active" (untouched, awaiting user decision)
  // and "tagged" (already categorized but not yet booked into
  // monthly_expenses). The slide-off animation in TxRow moves a row
  // from the active pile into the tagged pile after a categorize, OR
  // out of the rendered list entirely after an Ignore. User
  // feedback: "Once an item has been allocated or skipped/ignored,
  // please slide it off the list ... so the user feels like they
  // are making progress going down the list."
  type Debit = (typeof debits)[number];
  const activeDebits: Debit[] = [];
  const taggedDebits: Debit[] = [];
  for (const t of debits) {
    if (t.applied_expense_id || t.applied_category_code) {
      taggedDebits.push(t);
    } else {
      activeDebits.push(t);
    }
  }

  // Group ACTIVE debits by calendar month (posted_at "YYYY-MM-DD" →
  // "YYYY-MM"). Keeps the review legible on multi-month statements.
  // Rows without a posted_at fall into "No date" at the end so
  // they're never silently dropped.
  const monthMap = new Map<string, Debit[]>();
  for (const t of activeDebits) {
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
      <section className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-10">
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
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="display text-xl text-forest-900">
              {activeDebits.length === 0
                ? debits.length === 0
                  ? "No expense candidates"
                  : "All caught up — every row sorted"
                : `Expense candidates (${activeDebits.length})`}
            </h2>
            {/* Sneak peek of progress: shrinks as the user works. */}
            {debits.length > 0 ? (
              <span className="text-[11px] text-ink-muted">
                {debits.length - activeDebits.length} of {debits.length}{" "}
                sorted
              </span>
            ) : null}
          </div>
          {debits.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              No debit transactions in this file.
            </p>
          ) : activeDebits.length === 0 ? (
            <p className="mt-4 text-sm text-ink-soft">
              Every row has been categorized or skipped. Click{" "}
              <span className="font-medium text-forest-900">
                Apply manually selected
              </span>{" "}
              above to book the tagged ones into your monthly expenses.
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
                        setTxCategory={setTxCategory}
                        ignoreTx={ignoreTx}
                        teachBella={teachBella}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Tagged-but-not-applied pile — collapsed by default. Users
            picked a category here, the slide-off pulled the row out
            of the Active list, and now it lives here until they hit
            Apply. Open the details to review/change picks before
            committing. */}
        {taggedDebits.length > 0 ? (
          <section className="mt-6 card p-5">
            <details>
              <summary className="cursor-pointer select-none flex items-baseline justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
                    Sorted, awaiting Apply
                  </div>
                  <div className="display text-base text-forest-900 mt-1">
                    {taggedDebits.length}{" "}
                    {taggedDebits.length === 1 ? "row" : "rows"} tagged
                  </div>
                </div>
                <span className="text-xs text-ink-muted">
                  Click to review / change picks
                </span>
              </summary>
              <ul className="mt-4 grid gap-2">
                {taggedDebits.map((t) => (
                  <TxRow
                    key={t.id}
                    tx={t}
                    importId={importId}
                    companyId={company.id}
                    cats={catOptions}
                    frequentCodes={frequentCodes}
                    catById={catById}
                    isCredit={isCredit}
                    setTxCategory={setTxCategory}
                    ignoreTx={ignoreTx}
                    teachBella={teachBella}
                  />
                ))}
              </ul>
            </details>
          </section>
        ) : null}

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

