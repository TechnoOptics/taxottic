"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { logCompanyActivity } from "@/lib/activity/log";
import { parseCsv, sniffColumns, parseAmountCents } from "@/lib/csv/parse";
import {
  detectSignConvention,
  interpretAmount,
  planFlip,
  SIGN_CONFIDENCE_BANNER,
  type SignConvention,
} from "@/lib/csv/sign-convention";
import { summarizeImport } from "@/lib/csv/import-summary";
import {
  describeBatchOutcome,
  partitionBatch,
  type BatchIntent,
  type BatchRow,
  type BatchSkipReason,
} from "@/lib/csv/import-selection";
import { planExpenseBooking } from "@/lib/csv/expense-booking";
import { autoCategorize } from "@/lib/csv/auto-categorize";
import {
  categorizeBatch,
  type CategorizeInput,
} from "@/lib/csv/bella-categorize";
import { checkCsvImportLimit, isSuperAdmin } from "@/lib/plans/usage";
import { consume } from "@/lib/plans/credits";
import { evaluateBadges } from "@/lib/badges/evaluate";
import { applyRecurringExpenseDetection } from "@/lib/banking/recurring";
import {
  isSubscriptionLike,
  subscriptionFallbackKey,
  findCoveringRecurringRow,
  chargeFingerprint,
  type CoverCandidate,
} from "@/lib/banking/subscription-dedupe";
import {
  loadRules,
  matchRule,
  recordRuleHits,
  upsertRule,
  type RuleKind,
  type RulePatternType,
} from "@/lib/csv/categorization-rules";
import { findRefundPairs, type NettableTx } from "@/lib/csv/net-refunds";
import { bellaErrorMessage } from "@/lib/csv/bella-errors";

/**
 * Heuristic: looks like a credit-card payment from another account, not
 * a real charge. Used to skip rows on a credit import that would
 * otherwise inflate expenses.
 *
 * Real-world descriptions we've seen (May 2026 issuer audit):
 *   "MOBILE PAYMENT - THANK YOU"        Discover, Amex
 *   "PAYMENT - THANK YOU"               Amex
 *   "AUTOPAY PAYMENT"                   Chase
 *   "ONLINE PAYMENT, THANK YOU"         Capital One
 *   "AUTO PAYMENT - THANK YOU"          Citi
 *   "PAYMENT RECEIVED - THANK YOU"      Wells Fargo
 *
 * All variants share "payment" + a thanks/auto cue. The pattern below
 * matches singular AND plural "payment(s)" with either a dash, a comma,
 * or nothing between it and the "thank" / "received" keyword, plus
 * autopay-y phrases. Plural broke the prior regex (was only catching
 * "payment - thank you" singular) which is why the user's Discover
 * "MOBILE PAYMENTS - THANK YOU" row sailed straight through into the
 * expense queue.
 */
function looksLikeCardPayment(description: string | null): boolean {
  if (!description) return false;
  const d = description.toLowerCase();
  // Universal positive matches.
  if (
    d.includes("autopay") ||
    d.includes("auto pay") ||
    /\bpymt\b/.test(d) ||
    d.includes("ach payment")
  ) {
    return true;
  }
  // "payment(s)" + (thank you | received | from | -) in any order.
  const hasPaymentWord = /\bpayments?\b/.test(d);
  if (!hasPaymentWord) return false;
  return (
    d.includes("thank you") ||
    d.includes("received") ||
    d.includes(" from ") ||
    // "mobile payment(s)" is a card-payment idiom on Discover / Amex
    // even without an explicit "thank you" suffix.
    /\bmobile payments?\b/.test(d) ||
    /\bonline payments?\b/.test(d)
  );
}

async function userBelongsToCompany(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  userId: string,
  companyId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("company_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  return !!data;
}

const VALID_ACCOUNT_TYPES = new Set([
  "checking",
  "savings",
  "business_checking",
  "business_savings",
  "credit",
  "other",
]);

/**
 * Map any thrown error -> a short, user-facing message we can pass back
 * via ?error= on the import page. Common failure modes are normalized
 * so the user gets actionable copy instead of a raw Postgres error or
 * a Next 500. Anything we don't recognize falls through to a generic
 * "Upload failed" with the raw message appended for debuggability.
 */
function uploadErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Plan-limit guard string match - friendly upgrade copy
  if (/free CSV import|csv.*limit|csvImports/i.test(raw)) {
    return "You've reached your CSV-import limit for this month. Upgrade your plan or wait for next month.";
  }
  // Postgres unique violation (filename clash, duplicate import row)
  if (
    /duplicate key value|unique constraint|already exists/i.test(raw) ||
    /\b23505\b/.test(raw)
  ) {
    return "Looks like you already imported this file. Open the existing import or rename the CSV before re-uploading.";
  }
  // Postgres FK / RLS rejection
  if (/violates foreign key|row-level security|permission denied/i.test(raw)) {
    return "We couldn't save the import for this company. Refresh and try again.";
  }
  if (/CSV is empty|Could not find required columns|Invalid upload/i.test(raw)) {
    return raw;
  }
  if (/Not a member of this company/i.test(raw)) {
    return "You don't have access to this company.";
  }
  return `Upload failed: ${raw.slice(0, 200)}`;
}

/**
 * Pure import worker, does the auth + parse + insert + categorize
 * work and returns a result without any redirects. Both the
 * form-bound `uploadCsv` (which redirects on success/error) and the
 * client-callable `uploadCsvBatch` (which returns a result so a
 * multi-file dropzone can loop without each upload navigating away)
 * thunk through here.
 */
async function runCsvImport(formData: FormData): Promise<
  | { ok: true; importId: string; publicId: string }
  | { ok: false; error: string; publicId: string }
> {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const file = formData.get("file");
  const rawAccountType = String(formData.get("account_type") ?? "checking");
  const accountType = VALID_ACCOUNT_TYPES.has(rawAccountType)
    ? rawAccountType
    : "checking";

  // Resolve public_id once up front so the error redirect path is
  // available regardless of where in the flow we fail. We need it for
  // both the success redirect and the error redirect.
  let publicId = "";
  if (companyId) {
    const { data: company } = await admin
      .from("companies")
      .select("public_id")
      .eq("id", companyId)
      .maybeSingle();
    publicId = company?.public_id ?? "";
  }

  // The whole flow runs inside a try block so any thrown error - plan
  // limit, parse error, Postgres constraint violation, RLS rejection,
  // anything - lands the user back on the import page with a friendly
  // banner via ?error=, rather than rendering Next's generic 500
  // boundary. Previously a second-upload crash on demo was caused by
  // a thrown error from the action surfacing as "server error" because
  // the form had no client-side handler.
  let importId: string | null = null;
  try {
    if (!companyId || !(file instanceof File)) {
      throw new Error("Invalid upload");
    }
    if (!(await userBelongsToCompany(admin, user.id, companyId))) {
      throw new Error("Not a member of this company");
    }

    const limit = await checkCsvImportLimit(supabase, user.id);
    if (!limit.ok) {
      throw new Error(
        "You've used your CSV import allowance this month. Upgrade your plan to keep importing.",
      );
    }

    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error("CSV is empty or has no data rows");

    const headers = rows[0];
    const cols = sniffColumns(headers);
    if (cols.description === -1 || cols.amount === -1) {
      throw new Error(
        "Could not find required columns. CSV needs at least Description and Amount.",
      );
    }

    const dataRows = rows.slice(1);

    // Decide once, at upload, how this file's signs should be read, and
    // record it so the review page can state it and the user can
    // correct it. Amounts are stored exactly as parsed below (line
    // ~237); this only records how to read the signs already parsed,
    // it does not change parsing.
    const detected = detectSignConvention(
      dataRows.map((r) => ({
        amountCents: parseAmountCents(r[cols.amount] ?? ""),
      })),
    );
    // Credit-card statements conventionally list charges positive. When
    // the file is too thin to detect confidently, prefer that over the
    // charges_negative default: charges_negative on a credit import
    // reads every real charge as income and every refund as the only
    // expense candidate, which is emptier than the import actually is.
    // Same fallback as scripts/backfill-sign-convention.ts, scoped the
    // same way (credit imports only; a thin checking import keeps the
    // charges_negative default, which is what it has always meant).
    const signConvention: SignConvention =
      accountType === "credit" && detected.confidence < SIGN_CONFIDENCE_BANNER
        ? "charges_positive"
        : detected.convention;

    const { data: importRow, error: importErr } = await admin
      .from("bank_imports")
      .insert({
        company_id: companyId,
        user_id: user.id,
        filename: file.name,
        row_count: dataRows.length,
        status: "reviewing",
        account_type: accountType,
        sign_convention: signConvention,
        sign_convention_source: "detected",
        sign_convention_confidence: detected.confidence,
        sign_convention_set_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (importErr || !importRow) {
      throw new Error(importErr?.message ?? "import failed");
    }
    importId = importRow.id;

    const transactions = dataRows.map((r) => {
      const desc = (r[cols.description] ?? "").trim();
      const amountCents = parseAmountCents(r[cols.amount] ?? "");
      const dateRaw = cols.date >= 0 ? (r[cols.date] ?? "").trim() : "";
      const rawCategory =
        cols.category >= 0 ? (r[cols.category] ?? "").trim() : null;
      const suggested = desc ? autoCategorize(desc) : null;
      return {
        import_id: importRow.id,
        company_id: companyId,
        posted_at: parseDate(dateRaw),
        description: desc.slice(0, 500) || "(no description)",
        amount_cents: amountCents ?? 0,
        raw_category: rawCategory,
        suggested_category_code: suggested,
      };
    });

    // Exact-charge dedupe: a re-uploaded statement (or an overlapping
    // export) must not book the same charge twice. Identity = posted
    // date + exact cents + normalized description (chargeFingerprint):
    // "master the dates so we know it's the exact same charge". Compare
    // against every prior import for this company in the batch's date
    // range and drop matches before insert.
    const dates = transactions
      .map((t) => t.posted_at)
      .filter((d): d is string => !!d)
      .sort();
    let toInsert = transactions;
    if (dates.length > 0) {
      const { data: priorRows } = await admin
        .from("bank_transactions")
        .select("posted_at, amount_cents, description")
        .eq("company_id", companyId)
        .gte("posted_at", dates[0])
        .lte("posted_at", dates[dates.length - 1])
        .limit(10_000);
      const seen = new Set(
        (priorRows ?? []).map((r) =>
          chargeFingerprint(
            String(r.posted_at ?? ""),
            r.amount_cents as number,
            r.description as string | null,
          ),
        ),
      );
      toInsert = transactions.filter(
        (t) =>
          !t.posted_at ||
          !seen.has(
            chargeFingerprint(t.posted_at, t.amount_cents, t.description),
          ),
      );
    }

    const BATCH = 500;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const slice = toInsert.slice(i, i + BATCH);
      const { error } = await admin.from("bank_transactions").insert(slice);
      if (error) throw new Error(error.message);
    }

    // Auto-run Bella over the freshly-imported batch. Failures here
    // (insufficient credits, model timeout, anything else) are
    // swallowed - the import already succeeded and the user can still
    // categorize manually on the review page.
    try {
      await runBellaCategorize({
        supabase,
        admin,
        userId: user.id,
        importId: importRow.id,
        companyId,
        onInsufficientCredits: () => {
          // no-op: the user lands on the review page with rows
          // un-applied and can buy credits or categorize manually
        },
      });
    } catch (err) {
      console.error("auto-categorize on upload failed:", err);
    }
  } catch (err) {
    // runCsvImport is now a pure helper - never redirects. Just shape
    // the error into a return value the callers can act on. The
    // form-bound `uploadCsv` will translate this into a redirect; the
    // batch action will surface it as a JSON-friendly result.
    console.error("runCsvImport failed:", err);
    return {
      ok: false,
      error: uploadErrorMessage(err),
      publicId,
    };
  }

  if (!importId) {
    return { ok: false, error: "Upload failed", publicId };
  }
  return { ok: true, importId, publicId };
}

/**
 * Form-bound action: runs one CSV import and redirects to the review
 * page on success, or back to the import page with ?error= on
 * failure. Used by the single-file fallback flow.
 *
 * NOTE: The dropzone-based UI calls `uploadCsvBatch` instead so it
 * can loop without each upload navigating away mid-batch.
 */
export async function uploadCsv(formData: FormData) {
  const result = await runCsvImport(formData);
  if (result.ok) {
    revalidatePath(`/c/${result.publicId}/import`);
    redirect(`/c/${result.publicId}/import/${result.importId}`);
  }
  const path = result.publicId
    ? `/c/${result.publicId}/import`
    : "/dashboard";
  revalidatePath(path);
  redirect(`${path}?error=${encodeURIComponent(result.error)}`);
}

/**
 * Client-callable action used by the multi-file dropzone. Returns the
 * result instead of redirecting, so the dropzone can iterate through
 * a queue of files and only navigate the user once everything is in.
 *
 * The dropzone handles the post-batch navigation itself (router.push
 * to the last importId, or surfacing the error inline on the row
 * that failed).
 */
export async function uploadCsvBatch(formData: FormData): Promise<
  | { ok: true; importId: string; publicId: string }
  | { ok: false; error: string; publicId: string }
> {
  return runCsvImport(formData);
}

// applyTransactions was removed here. It was the action behind the
// "Apply manually selected" button, and it booked every row that
// happened to carry applied_category_code, which is not a selection.
// applySelected replaces it with an explicit list of ids, and the two
// could not both survive: applyTransactions carried its own copy of the
// booking rules, inline, with four bare `continue` statements, and a
// second copy of those rules is precisely how a $24.45 refund came to
// be booked as a deduction. The one copy now lives in
// planExpenseBooking.

export async function setTxCategory(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("category_code") ?? "");
  if (!id) return;

  // Verify the transaction belongs to a company the user is in.
  const { data: tx } = await admin
    .from("bank_transactions")
    .select("company_id")
    .eq("id", id)
    .maybeSingle();
  if (!tx || !(await userBelongsToCompany(admin, user.id, tx.company_id))) {
    throw new Error("Not authorized");
  }

  await admin
    .from("bank_transactions")
    .update({
      applied_category_code: code || null,
      ignored: false,
    })
    .eq("id", id);
  // Bug: this was `revalidatePath(\`/c/[publicId]/import/${importId}\`)` -
  // "[publicId]" as a literal string isn't a real path (a real URL is
  // /c/co_xyz/import/{importId}), so this never actually invalidated the
  // page the user was looking at. The "page" template form revalidates
  // the route for every company's public_id, which is what's needed here
  // since this action only has the internal company_id, not the public one.
  revalidatePath("/c/[publicId]/import/[importId]", "page");
  // The dashboard's outstanding-items bell/banner/popup read this same
  // table, without this a categorized transaction kept showing there
  // until the page's own cache TTL expired.
  revalidatePath("/dashboard");
}

export async function ignoreTx(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { data: tx } = await admin
    .from("bank_transactions")
    .select("company_id")
    .eq("id", id)
    .maybeSingle();
  if (!tx || !(await userBelongsToCompany(admin, user.id, tx.company_id))) {
    throw new Error("Not authorized");
  }

  await admin
    .from("bank_transactions")
    .update({ ignored: true, applied_category_code: null })
    .eq("id", id);
  revalidatePath("/c/[publicId]/import/[importId]", "page");
  revalidatePath("/dashboard");
}

/**
 * Change how one import's signs are read.
 *
 * Re-reads everything uncommitted and touches nothing that is already in
 * monthly_expenses. Booked rows (applied_expense_id set) always land in
 * planFlip's needsReview bucket and are never written to here: that
 * table is a filed-deduction surface, not something a sign correction
 * gets to silently restate.
 *
 * Writes, and only these:
 *   - bank_transactions.applied_category_code, cleared to null, but
 *     only for the ids planFlip puts in clearTag.
 *   - bank_imports.sign_convention, sign_convention_source,
 *     sign_convention_confidence, sign_convention_set_at.
 * Nothing else. applied_expense_id is never cleared and
 * monthly_expenses is never touched.
 */
export async function setSignConvention(formData: FormData) {
  const importId = String(formData.get("import_id") ?? "");
  const next = String(formData.get("convention") ?? "");
  if (!importId) return;
  if (next !== "charges_negative" && next !== "charges_positive") return;

  const { admin, user } = await requireUserWithAdmin();

  // Authorization pattern copied from setTxCategory / ignoreTx above:
  // resolve the owning company from the resource itself (not from a
  // client-supplied company_id) and check membership against that.
  const { data: imp } = await admin
    .from("bank_imports")
    .select("id, company_id, sign_convention")
    .eq("id", importId)
    .maybeSingle();
  if (!imp || !(await userBelongsToCompany(admin, user.id, imp.company_id as string))) {
    throw new Error("Not authorized");
  }

  const from = (imp.sign_convention as SignConvention | null) ?? "charges_negative";
  if (from === next) return; // already reading this way, nothing to do

  const { data: txs } = await admin
    .from("bank_transactions")
    .select("id, amount_cents, applied_category_code, applied_expense_id")
    .eq("import_id", importId);

  const plan = planFlip(
    (txs ?? []).map((t) => ({
      id: t.id as string,
      amountCents: t.amount_cents as number,
      appliedCategoryCode: t.applied_category_code as string | null,
      appliedExpenseId: t.applied_expense_id as string | null,
    })),
    from,
    next,
  );

  if (plan.clearTag.length > 0) {
    await admin
      .from("bank_transactions")
      .update({ applied_category_code: null })
      .in("id", plan.clearTag);
  }

  await admin
    .from("bank_imports")
    .update({
      sign_convention: next,
      sign_convention_source: "user",
      // An explicit user correction is as confident as this column
      // gets, and it keeps the review page from showing the
      // low-confidence banner right after the user just resolved it.
      sign_convention_confidence: 1,
      sign_convention_set_at: new Date().toISOString(),
    })
    .eq("id", importId);

  revalidatePath("/c/[publicId]/import/[importId]", "page");
  // A flip can clear applied_category_code (plan.clearTag above), which
  // changes the outstanding-items count that lib/tasks/outstanding.ts
  // reads, same reason setTxCategory / ignoreTx revalidate this path.
  revalidatePath("/dashboard");
}

/**
 * Load one import, prove the caller is in its company, and tally its
 * rows the derived way.
 *
 * Every batch and completion action starts here. The company is resolved
 * from the import itself and never from a client-supplied company_id, so
 * a forged field cannot widen the blast radius, and the tally comes from
 * summarizeImport rather than bank_imports.applied_count, which reads 0
 * on an import with 48 booked rows.
 */
async function loadImportForAction(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  userId: string,
  importId: string,
): Promise<{
  companyId: string;
  publicId: string;
  status: string;
  convention: SignConvention;
  accountType: string;
  rows: BatchRow[];
  summary: ReturnType<typeof summarizeImport>;
}> {
  const { data: imp } = await admin
    .from("bank_imports")
    .select("id, company_id, status, sign_convention, account_type")
    .eq("id", importId)
    .maybeSingle();
  if (!imp) throw new Error("Import not found");
  const companyId = imp.company_id as string;
  if (!(await userBelongsToCompany(admin, userId, companyId))) {
    throw new Error("Not authorized");
  }

  const { data: txs } = await admin
    .from("bank_transactions")
    .select(
      "id, import_id, company_id, description, amount_cents, posted_at, suggested_category_code, applied_category_code, applied_expense_id, applied_income_id, ignored",
    )
    .eq("import_id", importId)
    .eq("company_id", companyId);

  const rows: BatchRow[] = (txs ?? []).map((t) => ({
    id: t.id as string,
    importId: t.import_id as string,
    companyId: t.company_id as string,
    amountCents: t.amount_cents as number,
    suggestedCategoryCode: t.suggested_category_code as string | null,
    appliedCategoryCode: t.applied_category_code as string | null,
    appliedExpenseId: t.applied_expense_id as string | null,
    appliedIncomeId: t.applied_income_id as string | null,
    ignored: !!t.ignored,
    description: (t.description as string | null) ?? "",
    postedAt: t.posted_at as string | null,
  }));

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .maybeSingle();

  return {
    companyId,
    publicId: (company?.public_id as string | undefined) ?? "",
    status: (imp.status as string | null) ?? "reviewing",
    convention:
      (imp.sign_convention as SignConvention | null) ?? "charges_negative",
    accountType: (imp.account_type as string | null) ?? "checking",
    rows,
    summary: summarizeImport(rows),
  };
}

/**
 * Which of the chosen category codes never reach Schedule C.
 *
 * Three scopes are labels rather than deductions: transfer (moves
 * between accounts), personal (Schedule A items such as charity, SALT
 * and mortgage interest, which show up on a business card often enough
 * to be worth tagging), and credit (federal tax credits, which reduce
 * tax dollar for dollar rather than income). All three route through
 * ignored = true so the row stays labelled and categorized without
 * inflating the business deduction.
 */
async function loadNonBusinessCodes(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  codes: string[],
): Promise<Set<string>> {
  if (codes.length === 0) return new Set();
  const { data } = await admin
    .from("deduction_categories")
    .select("code, scope")
    .in("code", codes);
  return new Set(
    (data ?? [])
      .filter((c) => {
        const scope = (c as { scope?: string }).scope;
        return scope === "transfer" || scope === "personal" || scope === "credit";
      })
      .map((c) => (c as { code: string }).code),
  );
}

/**
 * Run one batch over the ids a form posted.
 *
 * The client's selection is a request, not an authorization. Every id is
 * re-derived server-side from rows loaded fresh out of the database:
 * partitionBatch drops anything that is a refund, already booked,
 * ignored, or owned by another import or company, and planExpenseBooking
 * decides row by row whether a write happens at all. A stale tab is the
 * ordinary case here, not an attack. The user opens the page, walks
 * away, Bella's cron books four rows, and they come back and press Apply
 * on a selection that includes them.
 *
 * Deliberately NOT atomic. Rows are inserted one at a time and a failure
 * on row 17 keeps the other 39. An all-or-nothing transaction sounds
 * safer and is not: it turns one bad row into zero progress, on a screen
 * whose entire complaint is that progress is too slow. The count of what
 * happened, and of everything that did not, goes back to the page in a
 * banner.
 */
async function runBatch(formData: FormData, intent: BatchIntent) {
  const importId = String(formData.get("import_id") ?? "");
  const postedIds = formData.getAll("tx_ids").map((v) => String(v));
  if (!importId) return;

  const { admin, user } = await requireUserWithAdmin();
  const ctx = await loadImportForAction(admin, user.id, importId);
  const back = `/c/${ctx.publicId}/import/${importId}`;

  const plan = partitionBatch(ctx.rows, postedIds, ctx.convention, {
    importId,
    companyId: ctx.companyId,
  }, intent);
  const skipped: { id: string; reason: BatchSkipReason }[] = [...plan.skipped];

  if (plan.actionable.length === 0 && skipped.length === 0) {
    redirect(`${back}?notice=${encodeURIComponent("Nothing was selected.")}`);
  }

  let done = 0;
  let labelled = 0;
  let failed = 0;

  if (intent === "ignore") {
    const ids = plan.actionable.map((a) => a.row.id);
    if (ids.length > 0) {
      const { error } = await admin
        .from("bank_transactions")
        .update({ ignored: true, applied_category_code: null })
        .in("id", ids);
      if (!error) {
        done = ids.length;
      } else {
        // One statement failed for the whole set, so retry row by row:
        // the batch is not atomic and the rows that can succeed should.
        for (const id of ids) {
          const { error: rowErr } = await admin
            .from("bank_transactions")
            .update({ ignored: true, applied_category_code: null })
            .eq("id", id);
          if (rowErr) failed++;
          else done++;
        }
      }
    }
  } else {
    const isCredit = ctx.accountType === "credit";
    const nonBusiness = await loadNonBusinessCodes(
      admin,
      Array.from(
        new Set(
          plan.actionable
            .map((a) => a.categoryCode)
            .filter((c): c is string => !!c),
        ),
      ),
    );
    const now = new Date();
    const taxYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    let booked = false;

    for (const { row, categoryCode } of plan.actionable) {
      const code = categoryCode as string;
      const decision = planExpenseBooking(
        { amountCents: row.amountCents, postedAt: row.postedAt },
        {
          convention: ctx.convention,
          taxYear,
          currentMonth,
          isNonBusinessCategory: nonBusiness.has(code),
          isCardPayment: isCredit && looksLikeCardPayment(row.description),
          isSubscription: isSubscriptionLike(row.description),
        },
      );

      if (decision.kind === "skip") {
        skipped.push({ id: row.id, reason: decision.reason });
        continue;
      }

      if (decision.kind === "label_only") {
        const { error } = await admin
          .from("bank_transactions")
          .update({ applied_category_code: code, ignored: true })
          .eq("id", row.id);
        if (error) failed++;
        else labelled++;
        continue;
      }

      const { data: created, error: insErr } = await admin
        .from("monthly_expenses")
        .insert({
          company_id: ctx.companyId,
          user_id: user.id,
          tax_year: taxYear,
          month: decision.month,
          amount_cents: decision.amountCents,
          category_code: code,
          recurrence: decision.recurrence,
          notes: row.description,
        })
        .select("id")
        .single();
      if (insErr || !created) {
        failed++;
        continue;
      }
      const { error: linkErr } = await admin
        .from("bank_transactions")
        .update({
          applied_expense_id: created.id,
          applied_category_code: code,
        })
        .eq("id", row.id);
      if (linkErr) {
        // The expense exists but nothing points at it. Roll back this
        // one row rather than leaving an orphan on the deduction
        // surface that no import can ever un-apply.
        await admin.from("monthly_expenses").delete().eq("id", created.id);
        failed++;
        continue;
      }
      done++;
      booked = true;
    }

    if (booked) {
      await logCompanyActivity(admin, {
        companyId: ctx.companyId,
        actorUserId: user.id,
        kind: "import.applied",
        summary: `Applied ${done} transaction${done === 1 ? "" : "s"} from an import`,
        payload: { import_id: importId, count: done, intent },
      });
      // The same recurring-stream detector the bank syncs run: a CSV
      // import is just another updated expense sheet.
      await applyRecurringExpenseDetection(admin, ctx.companyId, taxYear);
    }
  }

  const verb =
    intent === "ignore" ? "Ignored" : intent === "accept" ? "Accepted" : "Applied";
  const notice = describeBatchOutcome({ verb, done, skipped, failed, labelled });

  revalidatePath(back);
  revalidatePath(`/c/${ctx.publicId}/import`);
  revalidatePath(`/c/${ctx.publicId}/expenses`);
  revalidatePath(`/c/${ctx.publicId}/forecast`);
  revalidatePath("/dashboard");
  redirect(`${back}?notice=${encodeURIComponent(notice)}`);
}

/**
 * Book the selected rows that a human has already given a category.
 *
 * Reads applied_category_code and never falls back to
 * suggested_category_code: accepting Bella's proposal is
 * acceptSuggestions, a separate press. Keeping them apart preserves
 * something worth preserving on a tax record, which is whether a person
 * ever agreed with the software.
 */
export async function applySelected(formData: FormData) {
  await runBatch(formData, "apply");
}

/** Resolve the selected rows as not deductible. Writes no expense. */
export async function ignoreSelected(formData: FormData) {
  await runBatch(formData, "ignore");
}

/**
 * Take Bella up on her suggestions for the selected rows, and book them.
 *
 * This is the press that clears the reported backlog: thirteen rows
 * displaying a suggested category that looked chosen and was not,
 * because suggested_category_code is not applied_category_code and
 * nothing on the screen said so.
 */
export async function acceptSuggestions(formData: FormData) {
  await runBatch(formData, "accept");
}

/**
 * Record that a human saw a fully sorted import and agreed.
 *
 * Touches bank_imports.status, completed_at and completed_by. Nothing
 * else, and monthly_expenses least of all: every row this import will
 * ever contribute to a filed deduction was written when it was applied,
 * and Complete is a confirmation, not a commit. Calling it "Commit"
 * would imply the work had been held in escrow, and a user who believed
 * that might reasonably think abandoning an import discards it.
 *
 * Re-checks completeness from the rows rather than trusting the caller.
 * The button is absent while anything is unresolved, so this guard is
 * for stale tabs and direct posts, which are the ordinary case on a page
 * a user leaves open while Bella's cron works underneath them.
 *
 * Completing an already-complete import is a no-op, not an error.
 */
export async function completeImport(formData: FormData) {
  const importId = String(formData.get("import_id") ?? "");
  if (!importId) return;
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await loadImportForAction(admin, user.id, importId);
  const back = `/c/${ctx.publicId}/import/${importId}`;

  if (ctx.status === "complete") {
    revalidatePath(back);
    return;
  }
  if (!ctx.summary.isComplete) {
    const n = ctx.summary.unresolved;
    redirect(
      `${back}?error=${encodeURIComponent(
        n === 0
          ? "This import has no rows to complete."
          : `${n} row${n === 1 ? "" : "s"} still need${n === 1 ? "s" : ""} a category or an Ignore before this import can be completed.`,
      )}`,
    );
  }

  const { error } = await admin
    .from("bank_imports")
    .update({
      status: "complete",
      completed_at: new Date().toISOString(),
      completed_by: user.id,
    })
    .eq("id", importId);
  if (error) {
    redirect(
      `${back}?error=${encodeURIComponent(`Could not complete this import: ${error.message}`)}`,
    );
  }

  await logCompanyActivity(admin, {
    companyId: ctx.companyId,
    actorUserId: user.id,
    kind: "import.completed",
    summary: `Completed an import of ${ctx.summary.total} rows`,
    payload: { import_id: importId, rows: ctx.summary.total },
  });

  revalidatePath(`/c/${ctx.publicId}/import`);
  revalidatePath(back);
  redirect(`/c/${ctx.publicId}/import`);
}

/**
 * Undo a Complete. A status change and two nulls, because nothing was
 * destroyed to get here: discovering a mis-signed file after finishing
 * an import is precisely the case that has to stay recoverable.
 */
export async function reopenImport(formData: FormData) {
  const importId = String(formData.get("import_id") ?? "");
  if (!importId) return;
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await loadImportForAction(admin, user.id, importId);
  if (ctx.status !== "complete") return;

  await admin
    .from("bank_imports")
    .update({ status: "reviewing", completed_at: null, completed_by: null })
    .eq("id", importId);

  revalidatePath(`/c/${ctx.publicId}/import`);
  revalidatePath(`/c/${ctx.publicId}/import/${importId}`);
}

/**
 * Auto-categorize an entire import in one shot using Bella.
 *
 * Flow:
 *   1. Charge bulk_categorize credits (super admins skip).
 *   2. Pull every non-ignored, non-applied transaction from this
 *      import.
 *   3. Send the batch to Sonnet 4.5 with the company's allowed
 *      expense codes + income sources. Receives a per-row decision
 *      with a confidence score.
 *   4. For each row:
 *        confidence ≥ 0.85 + valid code → auto-apply
 *          - "expense" → insert monthly_expenses, link applied_expense_id
 *          - "income"  → insert monthly_income, link applied_income_id
 *          - "transfer" → mark ignored (transfers don't belong on the
 *            forecast)
 *        confidence  0.7-0.85 → set suggested_category_code only
 *        confidence < 0.7      → leave for human review
 *   5. Update bank_imports applied_count + status.
 *   6. Run evaluateBadges so any new medals (e.g. "first 100
 *      categorized expenses") get awarded immediately.
 *   7. Revalidate forecast / income / expense pages so the dashboard
 *      reflects the new entries on the next paint.
 *
 * For credit-card imports, the same card-payment heuristic from
 * applySelected books, those rows get auto-ignored before
 * Bella sees them. We don't pay tokens to classify obvious transfers.
 */
export async function bellaAutoApply(formData: FormData) {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const importId = String(formData.get("import_id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  if (!importId || !companyId) {
    throw new Error("Missing import_id or company_id");
  }
  if (!(await userBelongsToCompany(admin, user.id, companyId))) {
    throw new Error("Not a member of this company");
  }
  // Resolve public_id up front: we need it for the error redirect as
  // well as the revalidate, and it must be available even when the
  // categorize pass below throws.
  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .maybeSingle();
  const publicId = (company?.public_id as string | undefined) ?? "";

  // Every failure inside runBellaCategorize used to escape this Server
  // Action untouched, and React redacts an uncaught Server Action error
  // in production. The user got "An error occurred in the Server
  // Components render ... A digest property is included" instead of the
  // reason, and the reason never reached the logs either. Catch, log
  // the real cause server-side, and hand the user readable copy via
  // ?error= exactly like uploadCsv does.
  let failure: string | null = null;
  try {
    await runBellaCategorize({
      supabase,
      admin,
      userId: user.id,
      importId,
      companyId,
      onInsufficientCredits: (msg) => {
        throw new Error(msg);
      },
    });
  } catch (err) {
    console.error("bellaAutoApply failed:", err);
    failure = bellaErrorMessage(err);
  }

  // The action HAS to revalidate or the user clicks "Re-run Bella"
  // and sees no change, the categorize pass updated
  // bank_transactions but the page's RSC cache holds the old rows.
  // Reported as "rerun bella not working" on May 23 2026.
  if (publicId) {
    revalidatePath(`/c/${publicId}/import/${importId}`);
    revalidatePath(`/c/${publicId}/import`);
  }

  // redirect() throws NEXT_REDIRECT, so it has to sit outside the
  // try/catch above or the catch would swallow the navigation.
  if (failure) {
    if (!publicId) throw new Error(failure);
    redirect(
      `/c/${publicId}/import/${importId}?error=${encodeURIComponent(failure)}`,
    );
  }
}

/**
 * Internal: the actual categorize-and-apply flow. Callable from the
 * server action above (after permission check) and from uploadCsv
 * (right after a fresh CSV's rows are persisted, so a single upload
 * step finishes with everything categorized).
 *
 * onInsufficientCredits lets the caller decide what happens when the
 * user is out of credits, the manual button throws so the user sees
 * the error toast; the auto-flow swallows it and lets the user
 * categorize manually on the review page.
 */
async function runBellaCategorize(args: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>;
  userId: string;
  importId: string;
  companyId: string;
  onInsufficientCredits: (message: string) => void;
}): Promise<void> {
  const { supabase, admin, userId, importId, companyId } = args;
  // Local shim so the rest of the function, copied from the
  // original action body, keeps using `user.id` without churn.
  const user = { id: userId };

  const { data: imp } = await admin
    .from("bank_imports")
    .select("id, account_type, sign_convention, company_id")
    .eq("id", importId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!imp) throw new Error("Import not found");
  const accountType = (imp.account_type as string | null) ?? "checking";
  const isCredit = accountType === "credit";
  const convention =
    (imp.sign_convention as SignConvention | null) ?? "charges_negative";

  const { data: txs } = await admin
    .from("bank_transactions")
    .select(
      "id, description, amount_cents, posted_at, raw_category, applied_category_code, applied_expense_id, applied_income_id, ignored",
    )
    .eq("import_id", importId)
    .eq("company_id", companyId);

  // Pre-tag obvious credit-card-payment rows BEFORE Bella sees them.
  // On a credit import, looksLikeCardPayment matches "MOBILE PAYMENT -
  // THANK YOU" / "AUTOPAY" / etc, these are inter-account transfers,
  // not deductions. Tagging them with applied_category_code =
  // credit_card_payment + ignored=true removes them from the review
  // queue cleanly and keeps Bella from spending tokens classifying
  // rows we already know about. Only touches rows that haven't been
  // categorized or applied yet, so it's idempotent across re-runs.
  if (isCredit && txs) {
    const cardPaymentIds = txs
      .filter(
        (t) =>
          !t.ignored &&
          !t.applied_expense_id &&
          !t.applied_income_id &&
          !t.applied_category_code &&
          looksLikeCardPayment(t.description),
      )
      .map((t) => t.id);
    if (cardPaymentIds.length > 0) {
      await admin
        .from("bank_transactions")
        .update({
          applied_category_code: "credit_card_payment",
          ignored: true,
        })
        .in("id", cardPaymentIds);
    }
  }

  // Already-applied rows skip, we don't want to double-charge.
  // Card-payment rows we just tagged above are now ignored=true, so
  // the existing filter naturally excludes them; the redundant
  // looksLikeCardPayment guard stays as defense-in-depth.
  const candidates = (txs ?? []).filter(
    (t) =>
      !t.ignored &&
      !t.applied_expense_id &&
      !t.applied_income_id &&
      !(isCredit && looksLikeCardPayment(t.description)),
  );

  if (candidates.length === 0) {
    revalidatePath("/c/[publicId]/import/[importId]", "page");
    return;
  }

  // Bella memory: load the user's saved categorization rules. Any
  // candidate whose description matches a rule is categorized for
  // free, no Anthropic call, no credits charged for that row. The
  // remaining candidates are sent to the model.
  const savedRules = await loadRules(admin, user.id, companyId);
  type RuleHit = {
    txId: string;
    kind: "expense" | "income" | "ignore" | "transfer";
    code: string | null;
    ruleId: string;
  };
  const ruleHits: RuleHit[] = [];
  const remainingCandidates: typeof candidates = [];
  for (const t of candidates) {
    const m = matchRule(t.description ?? "", savedRules);
    if (m) {
      ruleHits.push({
        txId: t.id,
        kind: m.kind,
        code: m.code,
        ruleId: m.rule.id,
      });
    } else {
      remainingCandidates.push(t);
    }
  }
  // Bump usage counters in the background; failure is non-fatal.
  if (ruleHits.length > 0) {
    await recordRuleHits(admin, ruleHits.map((r) => r.ruleId)).catch(() => {});
  }

  // Charge credits ONLY if there are still rows that need the model.
  // Super admins bypass.
  const superAdmin = await isSuperAdmin(supabase);
  if (!superAdmin && remainingCandidates.length > 0) {
    const charge = await consume(admin, user.id, "bulk_categorize", importId);
    if (!charge.ok) {
      args.onInsufficientCredits(
        `Bella needs ${charge.needed} credits to categorize this import; you have ${charge.balance}. Top up at /billing.`,
      );
      // Even on insufficient credits, apply the rule-hit rows below so
      // saved-rule users always get value.
    }
  }

  // Pull the company's allowed deduction-category codes (business +
  // both scopes) so Bella can only choose categories the user can
  // actually file under.
  const { data: catRows } = await admin
    .from("deduction_categories")
    .select("code")
    .in("scope", ["business", "both"]);
  const allowedExpenseCodes = (catRows ?? []).map((c) => c.code as string);

  // monthly_income.source enum values, hard-coded since they live in
  // the postgres type rather than a table.
  const allowedIncomeSources = [
    "sales",
    "services",
    "wages_w2",
    "interest",
    "dividends",
    "rental",
    "royalty",
    "other",
  ];

  // Build the model-input list from rows the rules didn't claim.
  const inputs: CategorizeInput[] = remainingCandidates.map((t) => ({
    id: t.id,
    description: t.description ?? "",
    amount_cents: t.amount_cents,
    posted_at: t.posted_at,
    raw_category: t.raw_category,
  }));

  // Chunk size is bounded by the OUTPUT budget, not the input context:
  // the model must emit one object per row, at roughly 55-70 tokens
  // each (a 36-char UUID plus JSON scaffolding plus an <= 80-char
  // reason). 150 rows needed ~9000 output tokens against a 4000-token
  // cap, so a large import could only ever come back truncated. 60
  // rows against the categorizer's 8000-token cap leaves better than
  // 2x headroom. Each chunk is independent.
  const CHUNK = 60;
  const decisions: Awaited<ReturnType<typeof categorizeBatch>> = [];
  for (let i = 0; i < inputs.length; i += CHUNK) {
    const slice = inputs.slice(i, i + CHUNK);
    const part = await categorizeBatch({
      transactions: slice,
      allowedExpenseCodes,
      allowedIncomeSources,
      accountType,
    });
    decisions.push(...part);
  }
  // Inject rule hits as synthetic high-confidence decisions so the
  // downstream apply-loop treats them identically. Map our rule
  // "ignore" kind to the categorizer's "transfer" kind, both flow
  // through the apply loop's ignoreTxIds branch and get marked as
  // ignored in bank_transactions.
  for (const hit of ruleHits) {
    const kind =
      hit.kind === "ignore" ? "transfer" : (hit.kind as "expense" | "income" | "transfer");
    decisions.push({
      id: hit.txId,
      kind,
      code: hit.code,
      confidence: 1,
      reason: "saved categorization rule",
    });
  }

  const decByTxId = new Map(decisions.map((d) => [d.id, d]));
  const now = new Date();
  const taxYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  type ExpInsert = {
    company_id: string;
    user_id: string;
    tax_year: number;
    month: number;
    amount_cents: number;
    category_code: string;
    recurrence: string;
    notes: string;
  };
  type IncInsert = {
    company_id: string;
    user_id: string;
    tax_year: number;
    month: number;
    amount_cents: number;
    source: string;
    recurrence: string;
    recurring_key: string | null;
    notes: string;
  };

  const expenseInserts: ExpInsert[] = [];
  const expenseTxIds: string[] = [];
  const incomeInserts: IncInsert[] = [];
  const incomeTxIds: string[] = [];
  // INCOME double-count guard (same rationale as the bank syncs): a
  // recurring income row already projects future months, so an uploaded
  // charge its projection covers links to it instead of becoming a
  // second countable row.
  const { data: recIncome } = await admin
    .from("monthly_income")
    .select("id, tax_year, month, amount_cents, recurrence, recurring_key")
    .eq("company_id", companyId)
    .neq("recurrence", "one_off");
  const incomeCandidates = (recIncome ?? []) as CoverCandidate[];
  const coveredIncomeLinks: Array<{ txId: string; incomeId: string }> = [];
  const ignoreTxIds: string[] = [];
  const suggestionUpdates: Array<{
    id: string;
    code: string | null;
  }> = [];

  for (const tx of candidates) {
    const d = decByTxId.get(tx.id);
    if (!d) continue;

    // Always suggest the code so the user sees Bella's pick on review,
    // even when we don't auto-apply.
    if (d.code) suggestionUpdates.push({ id: tx.id, code: d.code });

    // Transfer → mark ignored regardless of confidence; transfers are
    // never a forecast input.
    if (d.kind === "transfer") {
      ignoreTxIds.push(tx.id);
      continue;
    }

    // Below the auto-apply threshold → leave it for the user.
    if (d.confidence < 0.85) continue;

    if (!tx.posted_at) continue;
    const posted = new Date(tx.posted_at + "T00:00:00Z");
    const txYear = posted.getUTCFullYear();
    const txMonth = posted.getUTCMonth() + 1;
    if (txYear !== taxYear) continue;
    if (txMonth > currentMonth) continue;

    const absCents = Math.abs(tx.amount_cents);
    if (absCents === 0) continue;

    const direction = interpretAmount(tx.amount_cents, convention).direction;

    if (d.kind === "expense" && d.code) {
      // Bella's own read of the row (d.kind) is not enough on its own:
      // never book as an expense unless the sign convention agrees this
      // row is actually a charge. Booking a refund, or an income row
      // Bella mis-called an expense, as a positive expense inflates the
      // deduction, the exact failure this task exists to prevent.
      if (direction !== "expense") continue;
      expenseInserts.push({
        company_id: companyId,
        user_id: user.id,
        tax_year: taxYear,
        month: txMonth,
        amount_cents: absCents,
        category_code: d.code,
        // "Subscription" in the line → monthly from day one (user rule).
        recurrence: isSubscriptionLike(tx.description) ? "monthly" : "one_off",
        notes: tx.description ?? "",
      });
      expenseTxIds.push(tx.id);
    } else if (d.kind === "income" && d.code && !isCredit) {
      // Mirror of the expense check above: never book an actual charge
      // as income.
      if (direction === "expense") continue;
      // Income on a credit account is always a payment-back; don't
      // create a phantom revenue line.
      const subLike = isSubscriptionLike(tx.description);
      const incKey =
        subLike && tx.description
          ? subscriptionFallbackKey(tx.description, absCents)
          : null;
      const covering = findCoveringRecurringRow(incomeCandidates, {
        tax_year: taxYear,
        month: txMonth,
        amount_cents: absCents,
        recurring_key: incKey,
      });
      if (covering) {
        // Already forecast by a recurring row, so link rather than double-count.
        coveredIncomeLinks.push({ txId: tx.id, incomeId: covering.id });
        continue;
      }
      incomeInserts.push({
        company_id: companyId,
        user_id: user.id,
        tax_year: taxYear,
        month: txMonth,
        amount_cents: absCents,
        source: d.code,
        recurrence: subLike ? "monthly" : "one_off",
        recurring_key: incKey,
        notes: tx.description ?? "",
      });
      incomeTxIds.push(tx.id);
    }
  }

  // Apply expense rows.
  if (expenseInserts.length > 0) {
    const { data: created } = await admin
      .from("monthly_expenses")
      .insert(expenseInserts)
      .select("id");
    if (created) {
      for (let i = 0; i < created.length; i++) {
        const txId = expenseTxIds[i];
        const exId = created[i]?.id;
        if (txId && exId) {
          await admin
            .from("bank_transactions")
            .update({
              applied_expense_id: exId,
              applied_category_code: expenseInserts[i].category_code,
            })
            .eq("id", txId);
        }
      }
      // Same recurring-stream detector the bank syncs run, Bella's
      // auto-apply is just another path new expense rows land through.
      await applyRecurringExpenseDetection(admin, companyId, taxYear);
    }
  }

  // Apply income rows.
  if (incomeInserts.length > 0) {
    const { data: created } = await admin
      .from("monthly_income")
      .insert(incomeInserts)
      .select("id");
    if (created) {
      for (let i = 0; i < created.length; i++) {
        const txId = incomeTxIds[i];
        const inId = created[i]?.id;
        if (txId && inId) {
          await admin
            .from("bank_transactions")
            .update({ applied_income_id: inId })
            .eq("id", txId);
        }
      }
    }
  }

  // Link uploads that were absorbed by an existing recurring row's
  // projection (no new monthly_income row created for them).
  for (const link of coveredIncomeLinks) {
    await admin
      .from("bank_transactions")
      .update({ applied_income_id: link.incomeId })
      .eq("id", link.txId);
  }

  // Bulk-update suggestions for the rows that ended up below
  // auto-apply but still got a category from Bella.
  for (const s of suggestionUpdates) {
    if (s.code) {
      await admin
        .from("bank_transactions")
        .update({ suggested_category_code: s.code })
        .eq("id", s.id);
    }
  }

  // Mark transfers as ignored.
  if (ignoreTxIds.length > 0) {
    await admin
      .from("bank_transactions")
      .update({ ignored: true, applied_category_code: null })
      .in("id", ignoreTxIds);
  }

  // Refresh applied_count + status on the import.
  const totalApplied = expenseInserts.length + incomeInserts.length;
  await admin
    .from("bank_imports")
    .update({
      applied_count: totalApplied,
      status: totalApplied > 0 ? "applied" : "reviewing",
    })
    .eq("id", importId);

  // Refund / charge auto-netting. User feedback: "if a user bought
  // 10 items and returned 2, bella would see that ... only apply the
  // difference or cancel them out completely and mark it as refunded."
  // v1 nets EXACT amount pairs from the same merchant within a 120-
  // day window. Partial returns stay in the candidates list (item-
  // level data isn't on the bank statement). Touches only rows that
  // are still untouched, anything the user already tagged stays
  // alone.
  const { data: pairTxs } = await admin
    .from("bank_transactions")
    .select(
      "id, description, amount_cents, posted_at, applied_category_code, applied_expense_id, applied_income_id, ignored",
    )
    .eq("import_id", importId)
    .eq("company_id", companyId);
  const pairs = findRefundPairs((pairTxs ?? []) as NettableTx[], convention);
  if (pairs.length > 0) {
    const allIds = pairs.flatMap((p) => [p.chargeId, p.refundId]);
    await admin
      .from("bank_transactions")
      .update({
        ignored: true,
        applied_category_code: "refunded",
      })
      .in("id", allIds);
  }

  // Re-evaluate badges so any newly-earned medals show up on the
  // user's next dashboard hit. Uses the cookie-auth supabase client
  // so RLS still applies.
  await evaluateBadges(supabase, user.id);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/import/${importId}`);
    revalidatePath(`/c/${company.public_id}/expenses`);
    revalidatePath(`/c/${company.public_id}/income`);
    revalidatePath(`/c/${company.public_id}/forecast`);
    revalidatePath(`/dashboard`);
  }
}

/**
 * Delete a previously-uploaded import. Allowed for the company's
 * managers and for super admins. Cascades through:
 *   1. Reverse anything we already applied, every monthly_expense
 *      and monthly_income created by this import gets deleted so the
 *      forecast doesn't keep reporting them.
 *   2. The bank_imports row itself, which CASCADEs to its
 *      bank_transactions.
 */
export async function deleteImport(formData: FormData) {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const importId = String(formData.get("import_id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  if (!importId || !companyId) throw new Error("Missing import_id or company_id");

  // Permission: company manager or super admin.
  const { data: superAdminRpc } = await supabase.rpc("is_super_admin");
  const isSuper = !!superAdminRpc;
  if (!isSuper) {
    const { data: membership } = await admin
      .from("company_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!membership || membership.role !== "manager") {
      throw new Error("Only managers can delete an import.");
    }
  }

  // Verify the import belongs to the claimed company so a tampered
  // company_id doesn't lead to deleting someone else's import.
  const { data: imp } = await admin
    .from("bank_imports")
    .select("id, company_id")
    .eq("id", importId)
    .maybeSingle();
  if (!imp || imp.company_id !== companyId) {
    throw new Error("Import not found");
  }

  // Find every monthly_expense / monthly_income that was created from
  // this import's transactions, then delete them. The
  // bank_transactions FKs are SET NULL on delete, so dropping the
  // expenses/income rows leaves the tx pointers dangling, but we
  // delete the bank_imports row right after (which CASCADEs to the
  // transactions), so the dangling state never persists.
  const { data: applied } = await admin
    .from("bank_transactions")
    .select("applied_expense_id, applied_income_id")
    .eq("import_id", importId);

  const expenseIds = (applied ?? [])
    .map((t) => t.applied_expense_id)
    .filter((id): id is string => !!id);
  const incomeIds = (applied ?? [])
    .map((t) => t.applied_income_id)
    .filter((id): id is string => !!id);

  if (expenseIds.length > 0) {
    await admin.from("monthly_expenses").delete().in("id", expenseIds);
  }
  if (incomeIds.length > 0) {
    await admin.from("monthly_income").delete().in("id", incomeIds);
  }

  await admin.from("bank_imports").delete().eq("id", importId);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  revalidatePath(`/c/${company?.public_id}/import`);
  revalidatePath(`/c/${company?.public_id}/expenses`);
  revalidatePath(`/c/${company?.public_id}/income`);
  revalidatePath(`/c/${company?.public_id}/forecast`);
  redirect(`/c/${company?.public_id}/import`);
}

/**
 * Teach Bella a categorization rule from the import-review page.
 *
 * Form fields:
 *   pattern         : the merchant string the user wants Bella to remember
 *   pattern_type    : exact | contains | starts_with
 *   kind            : expense | income | ignore | transfer
 *   category_code   : optional, required for expense/income
 *   company_id      : the company the rule belongs to (or empty for global)
 *   notes           : optional human-readable note
 *
 * The rule fires on the next import (and on the current import if the
 * user re-runs Auto-categorize). Idempotent on
 * (user, pattern_type, pattern), re-teaching updates the kind/code.
 */
export async function teachBella(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const pattern = String(formData.get("pattern") ?? "").trim();
  const patternType = String(formData.get("pattern_type") ?? "contains") as RulePatternType;
  const kind = String(formData.get("kind") ?? "expense") as RuleKind;
  const categoryCodeRaw = String(formData.get("category_code") ?? "").trim();
  const categoryCode = categoryCodeRaw || null;
  const companyIdRaw = String(formData.get("company_id") ?? "").trim();
  const companyId = companyIdRaw || null;
  const importIdRaw = String(formData.get("import_id") ?? "").trim();
  const importId = importIdRaw || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!pattern) throw new Error("Pattern is required");
  if (!["exact", "contains", "starts_with"].includes(patternType)) {
    throw new Error("Invalid pattern_type");
  }
  if (!["expense", "income", "ignore", "transfer"].includes(kind)) {
    throw new Error("Invalid kind");
  }
  // For expense/income, a category code is required so Bella knows
  // where to put future hits. Ignore/transfer don't need one.
  if ((kind === "expense" || kind === "income") && !categoryCode) {
    throw new Error("Category is required for expense/income rules");
  }

  // Verify the user is in this company (if company-scoped).
  if (companyId) {
    const { data: m } = await admin
      .from("company_members")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!m) throw new Error("Not a member of this company");
  }

  await upsertRule(admin, {
    userId: user.id,
    companyId,
    patternType,
    pattern,
    kind,
    categoryCode,
    notes,
  });

  // Retro-apply: pre-tag every OTHER row in the current import that
  // matches the new rule. User feedback (May 23 2026): "the system
  // should be intelligent and run ahead and auto set the others
  // that are from the same merchant and expense type." Without this,
  // a 100-row statement with 12 Lowe's charges makes the user retype
  // "Lowe's → Supplies" 12 times. The user still reads each row
  // (we don't apply expenses to monthly_expenses, that needs the
  // Apply button), we just stamp applied_category_code + ignored
  // so the review queue collapses to one decision per merchant.
  if (importId && companyId) {
    // Confirm the import belongs to this company so a forged
    // import_id from another tenant can't be touched.
    const { data: imp } = await admin
      .from("bank_imports")
      .select("id")
      .eq("id", importId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (imp) {
      const { data: candidates } = await admin
        .from("bank_transactions")
        .select("id, description, applied_category_code, ignored")
        .eq("import_id", importId)
        .eq("company_id", companyId)
        .eq("ignored", false)
        .is("applied_expense_id", null)
        .is("applied_income_id", null);

      const matching = (candidates ?? []).filter((t) => {
        if (t.applied_category_code) return false; // already tagged
        const haystack = (t.description ?? "").toLowerCase();
        const needle = pattern.toLowerCase();
        if (patternType === "exact") return haystack.trim() === needle;
        if (patternType === "starts_with") return haystack.startsWith(needle);
        return haystack.includes(needle); // contains
      });

      if (matching.length > 0) {
        const ids = matching.map((m) => m.id);
        const update: Record<string, unknown> = {};
        if (kind === "expense" || kind === "income") {
          update.applied_category_code = categoryCode;
        } else if (kind === "ignore") {
          update.ignored = true;
        } else if (kind === "transfer") {
          // Transfer = labelled but not booked. Mirror the
          // pre-tag we do for MOBILE PAYMENT - THANK YOU.
          update.applied_category_code = categoryCode;
          update.ignored = true;
        }
        if (Object.keys(update).length > 0) {
          await admin
            .from("bank_transactions")
            .update(update)
            .in("id", ids);
        }
      }
    }
  }

  if (companyId) {
    const { data: company } = await admin
      .from("companies")
      .select("public_id")
      .eq("id", companyId)
      .single();
    if (company) {
      revalidatePath(`/c/${company.public_id}/import`);
      if (importId) {
        revalidatePath(`/c/${company.public_id}/import/${importId}`);
      }
    }
  }
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const yy = Number(m[3]);
    const yyyy = yy < 70 ? 2000 + yy : 1900 + yy;
    const iso = new Date(Date.UTC(yyyy, Number(m[1]) - 1, Number(m[2]))).toISOString();
    return iso.slice(0, 10);
  }
  return null;
}

/**
 * Bulk-delete account_transactions for the current company. Manager-
 * only; the UI gates on isManager and this re-checks server-side.
 * Every id is validated against the join
 *   account_transactions → bank_accounts → bank_connections.company_id
 * so a manager can't accidentally (or maliciously) pass an id that
 * doesn't belong to their company.
 *
 * Confirmation: the form must include `confirm="delete"` (verbatim,
 * matches the UI's typed-delete affordance). Anything else throws.
 *
 * Cascades: account_transactions has children (apply records, etc.)
 * via the existing FK graph; if a child FK doesn't cascade the
 * DELETE errors loudly and the transaction rolls back. No half-state.
 */
export async function deleteAccountTransactions(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim().toLowerCase();
  const txIds = formData.getAll("tx_ids").map((v) => String(v));

  if (!companyId) throw new Error("Missing company_id.");
  if (confirm !== "delete") {
    throw new Error('Confirmation text must be exactly "delete".');
  }
  if (txIds.length === 0) {
    throw new Error("No transactions selected.");
  }

  // Manager-only, same role required to disconnect a bank.
  const { data: membership } = await admin
    .from("company_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (
    !membership ||
    (membership.role !== "manager" && membership.role !== "owner")
  ) {
    throw new Error("Only the company manager can delete transactions.");
  }

  // Validate every id belongs to a bank_connection of THIS company.
  // The inner-join filter (!inner) makes PostgREST return only rows
  // whose join chain resolves, so we can't accept stray ids.
  const { data: owned, error: selErr } = await admin
    .from("account_transactions")
    .select(
      "id, account:bank_accounts!inner(connection:bank_connections!inner(company_id))",
    )
    .in("id", txIds);
  if (selErr) throw new Error(selErr.message);
  const ownedIds = (owned ?? [])
    .filter((row) => {
      const acct = (row as unknown as {
        account: { connection: { company_id: string } };
      }).account;
      return acct?.connection?.company_id === companyId;
    })
    .map((r) => r.id as string);

  if (ownedIds.length === 0) {
    throw new Error("None of the selected transactions belong to this company.");
  }

  const { error: delErr, count } = await admin
    .from("account_transactions")
    .delete({ count: "exact" })
    .in("id", ownedIds);
  if (delErr) {
    throw new Error(
      `Delete failed (likely a child FK without ON DELETE CASCADE): ${delErr.message}`,
    );
  }

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company?.public_id) {
    revalidatePath(`/c/${company.public_id}/banks`);
    revalidatePath(`/c/${company.public_id}/forecast`);
  }

  // Surface the count for the client toast.
  return { deleted: count ?? ownedIds.length };
}

/**
 * Toggle bank_accounts.is_excluded. An excluded account stays linked
 * (you still see it in the list) but its transactions are filtered
 * out of forecast/deductions/etc., useful when an owner connects a
 * personal card alongside the business one. Manager-only.
 */
export async function setAccountExcluded(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const accountId = String(formData.get("account_id") ?? "");
  const company_id = String(formData.get("company_id") ?? "");
  const excludedRaw = String(formData.get("excluded") ?? "");
  const excluded =
    excludedRaw === "true" || excludedRaw === "1" || excludedRaw === "on";

  if (!accountId) throw new Error("Missing account_id.");
  if (!company_id) throw new Error("Missing company_id.");

  // Manager/owner only, same role required for disconnect / delete.
  const { data: membership } = await admin
    .from("company_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("company_id", company_id)
    .maybeSingle();
  if (
    !membership ||
    (membership.role !== "manager" && membership.role !== "owner")
  ) {
    throw new Error("Only the company manager can edit accounts.");
  }

  // Account must roll up to a bank_connection of THIS company.
  const { data: row } = await admin
    .from("bank_accounts")
    .select(
      "id, connection:bank_connections!inner(company_id)",
    )
    .eq("id", accountId)
    .maybeSingle();
  const ownerCompany = (row as unknown as {
    connection?: { company_id?: string };
  } | null)?.connection?.company_id;
  if (!row || ownerCompany !== company_id) {
    throw new Error("Account does not belong to this company.");
  }

  const { error } = await admin
    .from("bank_accounts")
    .update({ is_excluded: excluded })
    .eq("id", accountId);
  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", company_id)
    .single();
  if (company?.public_id) {
    revalidatePath(`/c/${company.public_id}/banks`);
    revalidatePath(`/c/${company.public_id}/forecast`);
  }
}
