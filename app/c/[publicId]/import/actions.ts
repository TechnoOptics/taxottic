"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { parseCsv, sniffColumns, parseAmountCents } from "@/lib/csv/parse";
import { autoCategorize } from "@/lib/csv/auto-categorize";
import {
  categorizeBatch,
  type CategorizeInput,
} from "@/lib/csv/bella-categorize";
import { checkCsvImportLimit, isSuperAdmin } from "@/lib/plans/usage";
import { consume } from "@/lib/plans/credits";
import { evaluateBadges } from "@/lib/badges/evaluate";
import {
  loadRules,
  matchRule,
  recordRuleHits,
  upsertRule,
  type RuleKind,
  type RulePatternType,
} from "@/lib/csv/categorization-rules";
import { findRefundPairs, type NettableTx } from "@/lib/csv/net-refunds";

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
 * Pure import worker — does the auth + parse + insert + categorize
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

    const { data: importRow, error: importErr } = await admin
      .from("bank_imports")
      .insert({
        company_id: companyId,
        user_id: user.id,
        filename: file.name,
        row_count: dataRows.length,
        status: "reviewing",
        account_type: accountType,
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

    const BATCH = 500;
    for (let i = 0; i < transactions.length; i += BATCH) {
      const slice = transactions.slice(i, i + BATCH);
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

export async function applyTransactions(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const importId = String(formData.get("import_id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  if (!importId || !companyId) return;
  if (!(await userBelongsToCompany(admin, user.id, companyId))) {
    throw new Error("Not a member of this company");
  }

  // Pull the import's account_type — credit-card imports take the
  // absolute value of every charge as an expense regardless of sign,
  // since issuers don't agree on charge-vs-payment sign conventions.
  const { data: imp } = await admin
    .from("bank_imports")
    .select("account_type")
    .eq("id", importId)
    .eq("company_id", companyId)
    .maybeSingle();
  const accountType = (imp?.account_type as string | null) ?? "checking";
  const isCredit = accountType === "credit";

  const { data: txs } = await admin
    .from("bank_transactions")
    .select(
      "id, description, amount_cents, posted_at, applied_category_code, applied_expense_id, applied_income_id, ignored",
    )
    .eq("import_id", importId)
    .eq("company_id", companyId);

  const applicable = (txs ?? []).filter(
    (t) =>
      !t.ignored &&
      t.applied_category_code &&
      !t.applied_expense_id &&
      !t.applied_income_id,
  );

  if (applicable.length === 0) {
    revalidatePath(`/c/${companyId}/import/${importId}`);
    return;
  }

  // Identify any non-Schedule-C scoped categories among the chosen
  // codes. Two scopes never book to monthly_expenses:
  //   transfer — inter-account moves (credit_card_payment etc.)
  //   personal — Schedule A items (charity, mortgage interest,
  //              SALT, volunteer mileage). Surfaced in the picker
  //              so users can tag personal rows that show up on a
  //              business credit-card statement, but they don't
  //              belong on Schedule C.
  // Both route via ignored=true so the row stays labelled +
  // categorized but doesn't inflate the business deduction.
  const chosenCodes = Array.from(
    new Set(
      applicable.map((t) => t.applied_category_code).filter(Boolean),
    ),
  ) as string[];
  let nonBusinessCodes = new Set<string>();
  if (chosenCodes.length > 0) {
    const { data: catScopes } = await admin
      .from("deduction_categories")
      .select("code, scope")
      .in("code", chosenCodes);
    nonBusinessCodes = new Set(
      (catScopes ?? [])
        .filter(
          (c) =>
            (c as { scope?: string }).scope === "transfer" ||
            (c as { scope?: string }).scope === "personal" ||
            // 'credit' scope is federal tax credits (Child Tax,
            // EITC, Residential Energy, etc.). They reduce TAX
            // dollar-for-dollar — not income — so they never
            // belong on Schedule C / monthly_expenses. Same
            // ignored=true route as transfers + Schedule A items.
            (c as { scope?: string }).scope === "credit",
        )
        .map((c) => (c as { code: string }).code),
    );
  }
  // Renamed for clarity; existing loop reference still uses
  // transferCodes — keep an alias so we don't break the rest of
  // the function in one edit.
  const transferCodes = nonBusinessCodes;
  const transferIds = applicable
    .filter((t) => transferCodes.has(t.applied_category_code!))
    .map((t) => t.id);
  if (transferIds.length > 0) {
    await admin
      .from("bank_transactions")
      .update({ ignored: true })
      .in("id", transferIds);
  }

  const now = new Date();
  const taxYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const expenseInserts: Array<{
    company_id: string;
    user_id: string;
    tax_year: number;
    month: number;
    amount_cents: number;
    category_code: string;
    notes: string;
  }> = [];

  const txUpdates: { id: string }[] = [];

  for (const tx of applicable) {
    // Transfers already handled above — skip the expense-insert loop.
    if (transferCodes.has(tx.applied_category_code!)) continue;
    if (!tx.posted_at) continue;
    const posted = new Date(tx.posted_at + "T00:00:00Z");
    const txYear = posted.getUTCFullYear();
    const txMonth = posted.getUTCMonth() + 1;
    if (txYear !== taxYear) continue;
    if (txMonth > currentMonth) continue;

    const absCents = Math.abs(tx.amount_cents);
    if (absCents === 0) continue;

    // Credit-card sign convention (audited against Discover/Amex/Chase
    // export on May 23 2026):
    //   POSITIVE amount → real charge → becomes an expense.
    //   NEGATIVE amount → refund OR card payment from another account.
    //     - Card-payment-back rows match looksLikeCardPayment → skip;
    //       they're inter-account transfers, never deductible.
    //     - Everything else negative is a refund → also skip from
    //       auto-apply. A refund offsets an earlier charge that was
    //       already booked; auto-booking it as either a positive expense
    //       (the prior abs() bug — inflated deductions) or a negative
    //       expense (would surface as an income tile, also wrong) gets
    //       it wrong either way. Leave for user review.
    if (isCredit) {
      if (looksLikeCardPayment(tx.description)) continue;
      if (tx.amount_cents < 0) continue; // refund — surface for review
      expenseInserts.push({
        company_id: companyId,
        user_id: user.id,
        tax_year: taxYear,
        month: txMonth,
        amount_cents: absCents,
        category_code: tx.applied_category_code!,
        notes: tx.description,
      });
      txUpdates.push({ id: tx.id });
      continue;
    }

    // Non-credit (checking/savings/other): keep the existing sign
    // convention — only negative amounts are expenses. Positive
    // amounts are income or transfers; the user can categorize those
    // manually for now.
    if (tx.amount_cents < 0) {
      expenseInserts.push({
        company_id: companyId,
        user_id: user.id,
        tax_year: taxYear,
        month: txMonth,
        amount_cents: absCents,
        category_code: tx.applied_category_code!,
        notes: tx.description,
      });
      txUpdates.push({ id: tx.id });
    }
  }

  if (expenseInserts.length === 0) return;

  const { data: createdExpenses, error: insErr } = await admin
    .from("monthly_expenses")
    .insert(expenseInserts)
    .select("id");
  if (insErr) throw new Error(insErr.message);

  for (let i = 0; i < createdExpenses.length; i++) {
    const tx = txUpdates[i];
    const ex = createdExpenses[i];
    if (!tx || !ex) continue;
    await admin
      .from("bank_transactions")
      .update({ applied_expense_id: ex.id })
      .eq("id", tx.id);
  }

  await admin
    .from("bank_imports")
    .update({
      applied_count: createdExpenses.length,
      status: "applied",
    })
    .eq("id", importId);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();

  revalidatePath(`/c/${company?.public_id}/import/${importId}`);
  revalidatePath(`/c/${company?.public_id}/expenses`);
  revalidatePath(`/c/${company?.public_id}/forecast`);
}

export async function setTxCategory(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("category_code") ?? "");
  const importId = String(formData.get("import_id") ?? "");
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
  revalidatePath(`/c/[publicId]/import/${importId}`);
}

export async function ignoreTx(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  const importId = String(formData.get("import_id") ?? "");
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
  revalidatePath(`/c/[publicId]/import/${importId}`);
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
 * applyTransactions applies — those rows get auto-ignored before
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
  // The action HAS to revalidate or the user clicks "Re-run Bella"
  // and sees no change — the categorize pass updated
  // bank_transactions but the page's RSC cache holds the old rows.
  // Reported as "rerun bella not working" on May 23 2026.
  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .maybeSingle();
  if (company) {
    revalidatePath(`/c/${company.public_id}/import/${importId}`);
    revalidatePath(`/c/${company.public_id}/import`);
  }
}

/**
 * Internal: the actual categorize-and-apply flow. Callable from the
 * server action above (after permission check) and from uploadCsv
 * (right after a fresh CSV's rows are persisted, so a single upload
 * step finishes with everything categorized).
 *
 * onInsufficientCredits lets the caller decide what happens when the
 * user is out of credits — the manual button throws so the user sees
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
  // Local shim so the rest of the function — copied from the
  // original action body — keeps using `user.id` without churn.
  const user = { id: userId };

  const { data: imp } = await admin
    .from("bank_imports")
    .select("id, account_type, company_id")
    .eq("id", importId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!imp) throw new Error("Import not found");
  const accountType = (imp.account_type as string | null) ?? "checking";
  const isCredit = accountType === "credit";

  const { data: txs } = await admin
    .from("bank_transactions")
    .select(
      "id, description, amount_cents, posted_at, raw_category, applied_category_code, applied_expense_id, applied_income_id, ignored",
    )
    .eq("import_id", importId)
    .eq("company_id", companyId);

  // Pre-tag obvious credit-card-payment rows BEFORE Bella sees them.
  // On a credit import, looksLikeCardPayment matches "MOBILE PAYMENT -
  // THANK YOU" / "AUTOPAY" / etc — these are inter-account transfers,
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

  // Already-applied rows skip — we don't want to double-charge.
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
    revalidatePath(`/c/[publicId]/import/${importId}`);
    return;
  }

  // Bella memory: load the user's saved categorization rules. Any
  // candidate whose description matches a rule is categorized for
  // free — no Anthropic call, no credits charged for that row. The
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

  // Chunk to ~150 rows per Anthropic call so we stay under context
  // limits even with chatty descriptions. Each chunk is independent.
  const CHUNK = 150;
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
  // "ignore" kind to the categorizer's "transfer" kind — both flow
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
    notes: string;
  };
  type IncInsert = {
    company_id: string;
    user_id: string;
    tax_year: number;
    month: number;
    amount_cents: number;
    source: string;
    notes: string;
  };

  const expenseInserts: ExpInsert[] = [];
  const expenseTxIds: string[] = [];
  const incomeInserts: IncInsert[] = [];
  const incomeTxIds: string[] = [];
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

    // Credit-card refund (negative amount on a credit account that
    // isn't a card-payment-back) → don't auto-book. Same rationale as
    // applyTransactions above: refunds offset an earlier charge and
    // need user judgement to either re-categorize the original or
    // mark the pair as a wash. Auto-applying a negative as either a
    // positive expense (inflates deduction) or a negative income
    // (phantom revenue) is wrong both ways.
    if (isCredit && tx.amount_cents < 0) continue;

    if (d.kind === "expense" && d.code) {
      expenseInserts.push({
        company_id: companyId,
        user_id: user.id,
        tax_year: taxYear,
        month: txMonth,
        amount_cents: absCents,
        category_code: d.code,
        notes: tx.description ?? "",
      });
      expenseTxIds.push(tx.id);
    } else if (d.kind === "income" && d.code && !isCredit) {
      // Income on a credit account is always a payment-back; don't
      // create a phantom revenue line.
      incomeInserts.push({
        company_id: companyId,
        user_id: user.id,
        tax_year: taxYear,
        month: txMonth,
        amount_cents: absCents,
        source: d.code,
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
  // are still untouched — anything the user already tagged stays
  // alone.
  const { data: pairTxs } = await admin
    .from("bank_transactions")
    .select(
      "id, description, amount_cents, posted_at, applied_category_code, applied_expense_id, applied_income_id, ignored",
    )
    .eq("import_id", importId)
    .eq("company_id", companyId);
  const pairs = findRefundPairs((pairTxs ?? []) as NettableTx[]);
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
 *   1. Reverse anything we already applied — every monthly_expense
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
  // expenses/income rows leaves the tx pointers dangling — but we
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
 *   category_code   : optional — required for expense/income
 *   company_id      : the company the rule belongs to (or empty for global)
 *   notes           : optional human-readable note
 *
 * The rule fires on the next import (and on the current import if the
 * user re-runs Auto-categorize). Idempotent on
 * (user, pattern_type, pattern) — re-teaching updates the kind/code.
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
  // (we don't apply expenses to monthly_expenses — that needs the
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

  // Manager-only — same role required to disconnect a bank.
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
 * out of forecast/deductions/etc. — useful when an owner connects a
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

  // Manager/owner only — same role required for disconnect / delete.
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
