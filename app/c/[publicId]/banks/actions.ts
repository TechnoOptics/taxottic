"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import {
  claimPendingTransaction,
  releasePendingTransaction,
  dismissPendingTransaction,
} from "@/lib/banking/claim";

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

async function loadTxContext(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  txId: string,
) {
  const { data } = await admin
    .from("account_transactions")
    .select(
      "id, amount_cents, posted_date, description, account:bank_accounts!inner(connection:bank_connections!inner(company_id))",
    )
    .eq("id", txId)
    .maybeSingle();
  if (!data) return null;
  const companyId = (
    data as unknown as {
      account: { connection: { company_id: string } };
    }
  ).account?.connection?.company_id;
  if (!companyId) return null;
  return {
    companyId,
    amountCents: data.amount_cents as number,
    postedDate: data.posted_date as string | null,
    description: data.description as string | null,
  };
}

async function revalidateBanksAndForecast(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  companyId: string,
) {
  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .maybeSingle();
  if (!company?.public_id) return;
  revalidatePath(`/c/${company.public_id}/banks`);
  revalidatePath(`/c/${company.public_id}/expenses`);
  revalidatePath(`/c/${company.public_id}/income`);
  revalidatePath(`/c/${company.public_id}/forecast`);
  // The dashboard's outstanding-items bell/banner/popup read this same
  // table, without this a resolved transaction kept showing there
  // until the page's own cache TTL expired.
  revalidatePath("/dashboard");
}

/**
 * Resolve a pending Plaid-synced transaction with a category pick.
 *
 * Expense rows (amount_cents > 0) book into monthly_expenses using the
 * chosen deduction_categories code, mirroring the auto-apply path in
 * lib/plaid/sync.ts but user-driven instead of confidence-scored.
 * Income rows (amount_cents < 0) book into monthly_income using the
 * chosen income_source enum value.
 *
 * A transfer/personal/credit-scoped category pick (or an empty pick,
 * i.e. the combobox's "Skip" option) never books to the forecast -
 * account_transactions has no column to remember a non-bookable
 * label, so these resolve the same way Dismiss does.
 */
export async function categorizeAccountTx(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("category_code") ?? "").trim();
  if (!id) return;

  const tx = await loadTxContext(admin, id);
  if (!tx || !(await userBelongsToCompany(admin, user.id, tx.companyId))) {
    throw new Error("Not authorized");
  }

  if (!code || !tx.postedDate) {
    await dismissPendingTransaction(admin, id, user.id);
    await revalidateBanksAndForecast(admin, tx.companyId);
    return;
  }

  const isExpense = tx.amountCents > 0;

  if (isExpense) {
    const { data: cat } = await admin
      .from("deduction_categories")
      .select("scope")
      .eq("code", code)
      .maybeSingle();
    const scope = (cat as { scope?: string } | null)?.scope;
    if (scope === "transfer" || scope === "personal" || scope === "credit") {
      await dismissPendingTransaction(admin, id, user.id);
      await revalidateBanksAndForecast(admin, tx.companyId);
      return;
    }
  }

  if (!(await claimPendingTransaction(admin, id, user.id))) {
    // Lost the race to a concurrent sync/claim, nothing left to do.
    await revalidateBanksAndForecast(admin, tx.companyId);
    return;
  }

  const posted = new Date(tx.postedDate + "T00:00:00Z");
  const taxYear = posted.getUTCFullYear();
  const month = posted.getUTCMonth() + 1;
  const absCents = Math.abs(tx.amountCents);

  if (isExpense) {
    const { data: row } = await admin
      .from("monthly_expenses")
      .insert({
        company_id: tx.companyId,
        user_id: user.id,
        tax_year: taxYear,
        month,
        amount_cents: absCents,
        category_code: code,
        notes: tx.description ?? "",
      })
      .select("id")
      .maybeSingle();
    if (row) {
      await admin
        .from("account_transactions")
        .update({ applied_to_expense_id: row.id })
        .eq("id", id);
    } else {
      await releasePendingTransaction(admin, id);
    }
  } else {
    const { data: row } = await admin
      .from("monthly_income")
      .insert({
        company_id: tx.companyId,
        user_id: user.id,
        tax_year: taxYear,
        month,
        amount_cents: absCents,
        source: code,
        notes: tx.description ?? "",
      })
      .select("id")
      .maybeSingle();
    if (row) {
      await admin
        .from("account_transactions")
        .update({ applied_to_income_id: row.id })
        .eq("id", id);
    } else {
      await releasePendingTransaction(admin, id);
    }
  }

  await revalidateBanksAndForecast(admin, tx.companyId);
}

/** Resolve a pending transaction as "not a deduction / not income" without booking anything. */
export async function dismissAccountTx(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const tx = await loadTxContext(admin, id);
  if (!tx || !(await userBelongsToCompany(admin, user.id, tx.companyId))) {
    throw new Error("Not authorized");
  }

  await dismissPendingTransaction(admin, id, user.id);
  await revalidateBanksAndForecast(admin, tx.companyId);
}
