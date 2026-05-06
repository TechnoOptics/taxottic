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

/**
 * Heuristic: looks like a credit-card payment from another account, not
 * a real charge. Used to skip rows on a credit import that would
 * otherwise inflate expenses.
 */
function looksLikeCardPayment(description: string | null): boolean {
  if (!description) return false;
  const d = description.toLowerCase();
  return (
    d.includes("autopay") ||
    d.includes("auto pay") ||
    d.includes("payment received") ||
    d.includes("payment - thank you") ||
    d.includes("payment thank you") ||
    /\bpymt\b/.test(d) ||
    (d.includes("payment") && d.includes("from")) ||
    d.includes("ach payment")
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

export async function uploadCsv(formData: FormData) {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const file = formData.get("file");
  const rawAccountType = String(formData.get("account_type") ?? "checking");
  const accountType = VALID_ACCOUNT_TYPES.has(rawAccountType)
    ? rawAccountType
    : "checking";
  if (!companyId || !(file instanceof File)) {
    throw new Error("Invalid upload");
  }
  if (!(await userBelongsToCompany(admin, user.id, companyId))) {
    throw new Error("Not a member of this company");
  }

  const limit = await checkCsvImportLimit(supabase, user.id);
  if (!limit.ok) {
    throw new Error(
      "You've used your free CSV import this month. Upgrade to Pro at /billing for unlimited imports.",
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
  if (importErr || !importRow) throw new Error(importErr?.message ?? "import failed");

  const transactions = dataRows.map((r) => {
    const desc = (r[cols.description] ?? "").trim();
    const amountCents = parseAmountCents(r[cols.amount] ?? "");
    const dateRaw = cols.date >= 0 ? (r[cols.date] ?? "").trim() : "";
    const rawCategory = cols.category >= 0 ? (r[cols.category] ?? "").trim() : null;
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

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();

  revalidatePath(`/c/${company?.public_id ?? ""}/import`);
  redirect(`/c/${company?.public_id ?? ""}/import/${importRow.id}`);
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
    if (!tx.posted_at) continue;
    const posted = new Date(tx.posted_at + "T00:00:00Z");
    const txYear = posted.getUTCFullYear();
    const txMonth = posted.getUTCMonth() + 1;
    if (txYear !== taxYear) continue;
    if (txMonth > currentMonth) continue;

    const absCents = Math.abs(tx.amount_cents);
    if (absCents === 0) continue;

    // Credit-card imports: every row becomes an expense regardless of
    // the sign on the original CSV. Card-payment-back rows (where the
    // user paid down the card from another account) are skipped via a
    // description-pattern heuristic — they're transfers, not biz
    // expenses, and double-counting them inflates the deduction.
    if (isCredit) {
      if (looksLikeCardPayment(tx.description)) continue;
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
      "id, description, amount_cents, posted_at, raw_category, applied_expense_id, applied_income_id, ignored",
    )
    .eq("import_id", importId)
    .eq("company_id", companyId);

  // Already-applied rows skip — we don't want to double-charge.
  // Also drop credit-card payment rows up-front to avoid wasting
  // tokens classifying them.
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

  // Charge credits before the model call. Super admins bypass.
  const superAdmin = await isSuperAdmin(supabase);
  if (!superAdmin) {
    const charge = await consume(admin, user.id, "bulk_categorize", importId);
    if (!charge.ok) {
      throw new Error(
        `Bella needs ${charge.needed} credits to categorize this import; you have ${charge.balance}. Top up at /billing.`,
      );
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

  const inputs: CategorizeInput[] = candidates.map((t) => ({
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
