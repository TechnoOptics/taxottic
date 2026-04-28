"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { parseCsv, sniffColumns, parseAmountCents } from "@/lib/csv/parse";
import { autoCategorize } from "@/lib/csv/auto-categorize";
import { checkCsvImportLimit } from "@/lib/plans/usage";

export async function uploadCsv(formData: FormData) {
  const { supabase, user } = await requireUser();
  const companyId = String(formData.get("company_id") ?? "");
  const file = formData.get("file");
  if (!companyId || !(file instanceof File)) {
    throw new Error("Invalid upload");
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

  const { data: importRow, error: importErr } = await supabase
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

  // Insert in batches of 500 to stay friendly to Supabase REST.
  const BATCH = 500;
  for (let i = 0; i < transactions.length; i += BATCH) {
    const slice = transactions.slice(i, i + BATCH);
    const { error } = await supabase.from("bank_transactions").insert(slice);
    if (error) throw new Error(error.message);
  }

  const { data: company } = await supabase
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();

  revalidatePath(`/c/${company?.public_id ?? ""}/import`);
  redirect(`/c/${company?.public_id ?? ""}/import/${importRow.id}`);
}

export async function applyTransactions(formData: FormData) {
  const { supabase, user } = await requireUser();
  const importId = String(formData.get("import_id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  if (!importId || !companyId) return;

  // Pull transactions ready to apply: not ignored, has applied_category_code,
  // not already applied.
  const { data: txs } = await supabase
    .from("bank_transactions")
    .select(
      "id, description, amount_cents, posted_at, applied_category_code, applied_expense_id, applied_income_id, ignored",
    )
    .eq("import_id", importId);

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

  // Group by month + category for efficient inserts.
  // Negative amounts -> expenses; positive amounts -> income.
  const taxYear = new Date().getUTCFullYear();
  const expenseInserts: Array<{
    company_id: string;
    user_id: string;
    tax_year: number;
    month: number;
    amount_cents: number;
    category_code: string;
    notes: string;
  }> = [];

  const txUpdates: { id: string; expense_id?: string }[] = [];

  for (const tx of applicable) {
    const month = tx.posted_at
      ? new Date(tx.posted_at + "T00:00:00Z").getUTCMonth() + 1
      : new Date().getUTCMonth() + 1;
    const absCents = Math.abs(tx.amount_cents);
    if (absCents === 0) continue;
    if (tx.amount_cents < 0) {
      expenseInserts.push({
        company_id: companyId,
        user_id: user.id,
        tax_year: taxYear,
        month,
        amount_cents: absCents,
        category_code: tx.applied_category_code!,
        notes: tx.description,
      });
      txUpdates.push({ id: tx.id });
    }
    // Positive amounts (deposits) we leave for now; users add income via the
    // dedicated Income page so we don't double-count refunds/transfers.
  }

  if (expenseInserts.length === 0) return;

  const { data: createdExpenses, error: insErr } = await supabase
    .from("monthly_expenses")
    .insert(expenseInserts)
    .select("id");
  if (insErr) throw new Error(insErr.message);

  // Map created expense IDs back to transactions in order, then mark applied.
  for (let i = 0; i < createdExpenses.length; i++) {
    const tx = txUpdates[i];
    const ex = createdExpenses[i];
    if (!tx || !ex) continue;
    await supabase
      .from("bank_transactions")
      .update({ applied_expense_id: ex.id })
      .eq("id", tx.id);
  }

  await supabase
    .from("bank_imports")
    .update({
      applied_count: createdExpenses.length,
      status: "applied",
    })
    .eq("id", importId);

  const { data: company } = await supabase
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();

  revalidatePath(`/c/${company?.public_id}/import/${importId}`);
  revalidatePath(`/c/${company?.public_id}/expenses`);
  revalidatePath(`/c/${company?.public_id}/forecast`);
}

export async function setTxCategory(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("category_code") ?? "");
  const importId = String(formData.get("import_id") ?? "");
  if (!id) return;
  await supabase
    .from("bank_transactions")
    .update({
      applied_category_code: code || null,
      ignored: false,
    })
    .eq("id", id);
  revalidatePath(`/c/[publicId]/import/${importId}`);
}

export async function ignoreTx(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  const importId = String(formData.get("import_id") ?? "");
  if (!id) return;
  await supabase
    .from("bank_transactions")
    .update({ ignored: true, applied_category_code: null })
    .eq("id", id);
  revalidatePath(`/c/[publicId]/import/${importId}`);
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  // Try MM/DD/YYYY, YYYY-MM-DD, or anything Date.parse can handle.
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  // MM/DD/YY
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const yy = Number(m[3]);
    const yyyy = yy < 70 ? 2000 + yy : 1900 + yy;
    const iso = new Date(Date.UTC(yyyy, Number(m[1]) - 1, Number(m[2]))).toISOString();
    return iso.slice(0, 10);
  }
  return null;
}
