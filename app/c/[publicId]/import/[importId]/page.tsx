import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { formatCents } from "@/lib/tax/forecast";
import {
  acceptSuggestions,
  applySelected,
  bellaAutoApply,
  completeImport,
  deleteImport,
  ignoreSelected,
  ignoreTx,
  reopenImport,
  setSignConvention,
  setTxCategory,
  teachBella,
} from "../actions";
import { summarizeImport } from "@/lib/csv/import-summary";
import { summarizeSelection } from "@/lib/csv/import-selection";
import { BatchSelectionProvider } from "@/components/import/BatchSelection";
import { isSuperAdmin } from "@/lib/plans/usage";
import { DeleteImportButton } from "@/components/DeleteImportButton";
import { type CategoryOption } from "@/components/CategoryCombobox";
import { TxRow } from "@/components/import/TxRow";
import { SignConventionBar } from "@/components/import/SignConventionBar";
import { interpretAmount, type SignConvention } from "@/lib/csv/sign-convention";

type Params = Promise<{ publicId: string; importId: string }>;
type Search = Promise<{
  highlight?: string;
  error?: string | string[];
  notice?: string | string[];
}>;

export default async function ImportReviewPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { publicId, importId } = await params;
  const {
    highlight: targetTxId,
    error: errRaw,
    notice: noticeRaw,
  } = await searchParams;
  // bellaAutoApply redirects here with ?error= when the categorize
  // pass fails, so the reason is visible instead of React's redacted
  // production digest.
  const errorMessage = Array.isArray(errRaw) ? errRaw[0] : errRaw;
  // Batch actions redirect here with ?notice= carrying their plain
  // tally: "Applied 39. Skipped 1 refund. 0 failed." A silent skip on a
  // deduction surface is indistinguishable from a bug.
  const noticeMessage = Array.isArray(noticeRaw) ? noticeRaw[0] : noticeRaw;
  const { supabase, user, company, isManager } =
    await loadCompanyByPublicId(publicId);
  const superAdmin = await isSuperAdmin(supabase);
  // A manager (or super admin) reconciles the whole company's bank
  // data; everybody else is limited to the imports they uploaded
  // themselves. Same shape the RLS policies now enforce.
  const canReadAnyImport = isManager || superAdmin;
  const canDelete = canReadAnyImport;

  const { data: imp } = await supabase
    .from("bank_imports")
    .select(
      "id, user_id, filename, status, row_count, applied_count, account_type, sign_convention, sign_convention_source, sign_convention_confidence, created_at",
    )
    .eq("id", importId)
    .eq("company_id", company.id)
    .single();
  if (!imp) notFound();
  // Defence in depth. RLS is the real boundary, but this route used to
  // reach for the rows first and only call notFound() when the import
  // row was missing, so a direct URL was enough to read somebody
  // else's bank statement the moment the policy was too broad. Check
  // before rendering, not after.
  if (!canReadAnyImport && imp.user_id !== user.id) notFound();
  const isCredit = imp.account_type === "credit";

  const [{ data: txs }, { data: categories }] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select(
        "id, description, amount_cents, posted_at, raw_category, suggested_category_code, applied_category_code, applied_expense_id, applied_income_id, ignored",
      )
      .eq("import_id", importId)
      .order("posted_at", { ascending: false })
      .order("description"),
    supabase
      .from("deduction_categories")
      // Now includes 'personal' so charity / SALT / mortgage-interest
      // / volunteer-mileage are tag-able from a credit-card import
      // (those rows are often mixed in with business charges on the
      // same card). applySelected routes personal AND transfer
      // picks via ignored=true so they never inflate the Schedule C
      // deduction, they're labels, not bookings.
      // Pull irc_section + irs_pub so the TxRow can show the
      // citation next to each detected category.
      .select(
        "code, label, scope, schedule_c_line, irc_section, irs_pub, irs_url, display_group",
      )
      .in("scope", ["business", "both", "transfer", "personal", "credit"])
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
      display_group: string | null;
    }[] | null) ?? [];
  // Build the option list. hint = Schedule C line for the per-row
  // strip on the right of the dropdown; group = display_group so
  // the combobox renders section headers when no query is active.
  const catOptions: CategoryOption[] = cats.map((c) => ({
    code: c.code,
    label: c.label,
    hint: c.schedule_c_line,
    scope: c.scope,
    group: c.display_group,
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

  // Most-used category codes for THIS company, used to bubble
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

  // Progress is derived from the rows on every render, never read from
  // bank_imports.applied_count. That column reads 0 on the 2026-08-01
  // import while 48 of its rows are booked, because the upload-time
  // auto-categorize path that booked most of them never writes it.
  const progress = summarizeImport(
    (txs ?? []).map((t) => ({
      appliedExpenseId: t.applied_expense_id,
      appliedIncomeId: t.applied_income_id,
      ignored: !!t.ignored,
    })),
  );
  const isCompleted = imp.status === "complete";

  const convention = (imp.sign_convention ?? "charges_negative") as SignConvention;
  const direction = (t: { amount_cents: number }) =>
    interpretAmount(t.amount_cents, convention).direction;

  // Rows already booked into monthly_expenses whose direction would
  // read differently under the previous convention. Only meaningful
  // after an actual user flip (sign_convention_source === 'user'):
  // for every non-zero amount the direction always differs between
  // the two conventions, so without this gate the count would just be
  // "booked and non-zero" and fire a false "review these" banner on
  // every import that has ever been applied, even ones that were
  // never flipped. A flip never rewrites these rows (planFlip always
  // returns booked rows to the caller for review, never modifies
  // them), so once the user does flip, these are the rows worth
  // double-checking against this month's totals.
  const other: SignConvention =
    convention === "charges_positive" ? "charges_negative" : "charges_positive";
  const bookedUnderPrevious =
    imp.sign_convention_source === "user"
      ? (txs ?? []).filter(
          (t) =>
            t.applied_expense_id &&
            interpretAmount(t.amount_cents, convention).direction !==
              interpretAmount(t.amount_cents, other).direction,
        ).length
      : 0;

  // Expense candidates are rows the convention says are charges. Refunds
  // and income are deliberately excluded: a refund booked as an expense
  // inflates a deduction, which is what happened to a $24.45 return on
  // the 2026-08-01 import.
  const allActive = (txs ?? []).filter((t) => !t.ignored);
  const debits = allActive.filter((t) => direction(t) === "expense");
  const credits = allActive.filter((t) => direction(t) !== "expense");
  const ignoredRows = (txs ?? []).filter((t) => t.ignored);

  // What a checkbox may appear on, decided here by the same isSelectable
  // the server actions re-run over the posted ids. Refunds, income and
  // already-booked rows are absent from this list, so a select-all
  // cannot reach them. That is the guarantee, and it is structural: a
  // disabled checkbox would be one markup change away from reachable.
  const selectionRows = (txs ?? []).map((t) => ({
    id: t.id,
    importId,
    companyId: company.id,
    amountCents: t.amount_cents,
    suggestedCategoryCode: t.suggested_category_code,
    appliedCategoryCode: t.applied_category_code,
    appliedExpenseId: t.applied_expense_id,
    appliedIncomeId: t.applied_income_id,
    ignored: !!t.ignored,
  }));
  const selection = summarizeSelection(selectionRows, [], convention);
  const selectableIds = selection.selectableIds;
  const selectableSet = new Set(selectableIds);

  // Rows a human already gave a category and that are not booked yet.
  // The old "Apply manually selected" button applied exactly these while
  // claiming they had been selected; nothing on the page could be
  // selected, so the count was a residue of pressing Save row by row.
  const pendingApply = debits.filter(
    (t) => selectableSet.has(t.id) && t.applied_category_code,
  );
  // Bella's ungrafted suggestions: the reported backlog. These display a
  // category that looks chosen and is not, because
  // suggested_category_code is a different column from
  // applied_category_code and nothing on screen said so.
  const pendingSuggestions = debits.filter(
    (t) =>
      selectableSet.has(t.id) &&
      t.suggested_category_code &&
      !t.applied_category_code,
  );

  // Bella detection rollup, shown at the top of the review section
  // so the user can see at a glance "Bella tagged X, you tagged Y,
  // these N are still untouched." Computed from in-memory debits
  // (already loaded above), no extra round-trip.
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

  // Deep-linked from the outstanding-items list (?highlight=<id>): if
  // the target row already got tagged since the item was surfaced,
  // it lives in the collapsed "Sorted, awaiting Apply" pile, force
  // that <details> open so TxRow's scrollIntoView can actually reach it.
  const targetInTagged =
    !!targetTxId && taggedDebits.some((t) => t.id === targetTxId);
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
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-10">
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
          {progress.total} rows uploaded -{" "}
          {progress.applied > 0
            ? `${progress.applied} applied`
            : "not yet applied"}
          {progress.income > 0 ? ` - ${progress.income} booked as income` : ""}
          {progress.ignored > 0 ? ` - ${progress.ignored} ignored` : ""}
        </div>
        {isCredit ? (
          <p className="mt-2 text-xs text-ink-muted max-w-2xl leading-relaxed">
            Credit-card import: charges are read using this file&apos;s
            detected sign convention, not a fixed rule, so refunds aren&apos;t
            offered as expenses. We auto-skip rows that look like card
            payments (autopay, payment received, etc.) so they aren&apos;t
            double-counted.
          </p>
        ) : null}

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

        {noticeMessage ? (
          <div
            role="status"
            className="mt-6 rounded-lg border border-forest-200 bg-white/70 px-4 py-3 text-sm text-forest-900"
          >
            {noticeMessage}
          </div>
        ) : null}

        {/* The resting state. Nothing here writes to monthly_expenses:
            every row this import contributes to a filed deduction was
            written when it was applied, so this is a confirmation, not
            a commit, and it is deliberately not called Commit. The
            button is absent while anything is unresolved, because a
            Complete offered over unsorted rows is a way to lose work. */}
        {isCompleted ? (
          <section className="mt-6 card p-5 flex items-center justify-between gap-4 flex-wrap border-emerald-200">
            <div>
              <div className="display text-base text-forest-900">
                This import is complete
              </div>
              <p className="text-xs text-ink-muted mt-1 max-w-xl leading-relaxed">
                All {progress.total} rows are sorted and it has moved to the
                completed section of the import list. Reopening changes the
                status back, nothing was destroyed to get here.
              </p>
            </div>
            <form action={reopenImport}>
              <input type="hidden" name="import_id" value={importId} />
              <button className="btn-ghost">Reopen import</button>
            </form>
          </section>
        ) : progress.isComplete ? (
          <section className="mt-6 card p-5 flex items-center justify-between gap-4 flex-wrap border-emerald-200">
            <div>
              <div className="display text-base text-forest-900">
                All {progress.total} rows are sorted
              </div>
              <p className="text-xs text-ink-muted mt-1 max-w-xl leading-relaxed">
                {progress.applied} applied
                {progress.income > 0 ? `, ${progress.income} booked as income` : ""}
                {progress.ignored > 0 ? `, ${progress.ignored} ignored` : ""}.
                Your expenses and forecast already reflect this. Completing
                files the import away, and you can reopen it at any time.
              </p>
            </div>
            <form action={completeImport}>
              <input type="hidden" name="import_id" value={importId} />
              <button className="btn-primary">Complete import</button>
            </form>
          </section>
        ) : null}

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
              Bella already read this import on upload, high-confidence
              rows are applied; lower-confidence rows are below with her
              suggested category. Click to re-run if you added new rows or
              changed the account type. Costs 10 credits; super admins
              free.
            </p>
          </div>
          <button className="btn-ghost">Re-run Bella</button>
        </form>

        {/* The standing action that clears the reported backlog in one
            press. Deliberately separate from Apply: Bella's own
            confidence threshold already decides what she books
            unattended, and this is the explicit accept of what she was
            not confident enough to book alone. Keeping the two apart
            preserves whether a human ever agreed with the software,
            which is worth preserving on a tax record. */}
        {pendingSuggestions.length > 0 ? (
          <form
            action={acceptSuggestions}
            className="mt-4 card p-5 flex items-center justify-between gap-4 flex-wrap border-gold-300/60"
          >
            <input type="hidden" name="import_id" value={importId} />
            {pendingSuggestions.map((t) => (
              <input key={t.id} type="hidden" name="tx_ids" value={t.id} />
            ))}
            <div>
              <div className="display text-base text-forest-900">
                Bella suggested categories for {pendingSuggestions.length} row
                {pendingSuggestions.length === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-ink-muted mt-1 max-w-xl leading-relaxed">
                Those rows show a suggestion, not a decision. Accepting sets
                the category and books each one as a deductible expense in
                the month it was posted. Refunds are never included.
              </div>
            </div>
            <button className="btn-ghost">
              Accept all {pendingSuggestions.length}
            </button>
          </form>
        ) : null}

        {pendingApply.length > 0 ? (
          <form
            action={applySelected}
            className="mt-4 card p-5 flex items-center justify-between gap-4 flex-wrap"
          >
            <input type="hidden" name="import_id" value={importId} />
            {pendingApply.map((t) => (
              <input key={t.id} type="hidden" name="tx_ids" value={t.id} />
            ))}
            <div>
              <div className="display text-base text-forest-900">
                {pendingApply.length} row
                {pendingApply.length === 1 ? "" : "s"} you categorized are not
                booked yet
              </div>
              <div className="text-xs text-ink-muted mt-1">
                Each becomes a deductible expense entry on the month it was
                posted.
              </div>
            </div>
            <button className="btn-ghost">
              Apply these {pendingApply.length}
            </button>
          </form>
        ) : null}

        {/* Bella detection rollup, surfaces "what did the model see"
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
                  • {stats.bellaSuggested} pre-tagged by Bella for review
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

        <div className="mt-6">
          <SignConventionBar
            importId={importId}
            convention={convention}
            confidence={imp.sign_convention_confidence as number | null}
            bookedUnderPrevious={bookedUnderPrevious}
            setSignConvention={setSignConvention}
          />
        </div>

        {/* Selection spans both piles below, so one Apply commits what
            the user ticked wherever it sits. Selection is client state
            only: nothing is persisted, because a stored "selected" flag
            would be a second source of truth about what the user meant,
            and that is how applied_count came to read 0. */}
        <BatchSelectionProvider
          importId={importId}
          selectableIds={selectableIds}
          applySelected={applySelected}
          ignoreSelected={ignoreSelected}
          acceptSuggestions={acceptSuggestions}
        >
        <section className="mt-6 card p-6">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="display text-xl text-forest-900">
              {activeDebits.length === 0
                ? debits.length === 0
                  ? "No expense candidates"
                  : "All caught up, every row sorted"
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
              Every row has been categorized or skipped. Tick the rows you
              want and use the bar at the bottom, or use the buttons above
              to book them all into your monthly expenses.
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
                        convention={convention}
                        setTxCategory={setTxCategory}
                        ignoreTx={ignoreTx}
                        teachBella={teachBella}
                        highlight={t.id === targetTxId}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Tagged-but-not-applied pile, collapsed by default. Users
            picked a category here, the slide-off pulled the row out
            of the Active list, and now it lives here until they hit
            Apply. Open the details to review/change picks before
            committing. */}
        {taggedDebits.length > 0 ? (
          <section className="mt-6 card p-5">
            <details open={targetInTagged}>
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
                    convention={convention}
                    setTxCategory={setTxCategory}
                    ignoreTx={ignoreTx}
                    teachBella={teachBella}
                    highlight={t.id === targetTxId}
                  />
                ))}
              </ul>
            </details>
          </section>
        ) : null}
        </BatchSelectionProvider>

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
                      {direction(t) === "refund"
                        ? " · Refund, not deductible"
                        : ""}
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

