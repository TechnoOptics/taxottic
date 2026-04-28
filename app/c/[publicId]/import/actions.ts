"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { parseCsv, sniffColumns, parseAmountCents } from "@/lib/csv/parse";
import { autoCategorize } from "@/lib/csv/auto-categorize";
import { checkCsvImportLimit } from "@/lib/plans/usage";

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

export async function uploadCsv(formData: FormData) {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const file = formData.get("file");
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
    if (!tx.posted_at) continue; // skip transactions with no date
    const posted = new Date(tx.posted_at + "T00:00:00Z");
    const txYear = posted.getUTCFullYear();
    const txMonth = posted.getUTCMonth() + 1;
    // Skip rows that are not in the current tax year or are future-dated.
    if (txYear !== taxYear) continue;
    if (txMonth > currentMonth) continue;

    const absCents = Math.abs(tx.amount_cents);
    if (absCents === 0) continue;
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
