import type { SupabaseClient } from "@supabase/supabase-js";

// "Tax readiness" is a single 0-100 score blending two things the user can
// directly act on:
//   • engagement - how much of their imported bank activity they've actually
//     triaged (categorized / dismissed / split). Pending-forever is what we're
//     trying to push back against.
//   • coverage   - how many distinct deduction categories they've claimed YTD
//     against a reasonable starter target (TARGET_CATEGORIES). Most active
//     small businesses naturally hit 6-12; 8 is a comfortable mid-target that
//     reads as "doing well" without being unreachable.
//
// If a company has no bank feed, engagement isn't measurable and we fall back
// to coverage alone - otherwise users without Plaid would be stuck at 0%
// forever.

export type Readiness = {
  score: number; // 0-100, rounded
  triagedTx: number;
  totalTx: number;
  categoriesUsed: number;
  targetCategories: number;
  hasBankFeed: boolean;
};

const TARGET_CATEGORIES = 8;
const WINDOW_DAYS = 90;

export async function computeReadiness(
  admin: SupabaseClient,
  companyId: string,
  taxYear: number,
): Promise<Readiness> {
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Bank connections → accounts → tx, scoped to this company. Three small
  // queries beat a single deeply-nested PostgREST select for readability and
  // gives us a clean account-id list to count against.
  //
  // That chain is genuinely sequential: each step needs the ids the previous
  // one returned. The deduction-category count is not, it only needs
  // companyId and taxYear. It used to sit AFTER the chain, so this function
  // cost four sequential round trips, once per company, on every dashboard
  // render. Running the two independent halves concurrently makes it three,
  // with byte-identical results.
  const [bank, { data: catRows }] = await Promise.all([
    (async () => {
      const { data: connections } = await admin
        .from("bank_connections")
        .select("id")
        .eq("company_id", companyId)
        .neq("status", "revoked");
      const connectionIds = (connections ?? []).map((c) => c.id as string);
      if (connectionIds.length === 0) return { totalTx: 0, triagedTx: 0 };

      const { data: accounts } = await admin
        .from("bank_accounts")
        .select("id")
        .in("connection_id", connectionIds);
      const accountIds = (accounts ?? []).map((a) => a.id as string);
      if (accountIds.length === 0) return { totalTx: 0, triagedTx: 0 };

      const [{ count: total }, { count: triaged }] = await Promise.all([
        admin
          .from("account_transactions")
          .select("id", { count: "exact", head: true })
          .in("account_id", accountIds)
          .gte("posted_date", windowStart),
        admin
          .from("account_transactions")
          .select("id", { count: "exact", head: true })
          .in("account_id", accountIds)
          .gte("posted_date", windowStart)
          .neq("user_action", "pending"),
      ]);
      return { totalTx: total ?? 0, triagedTx: triaged ?? 0 };
    })(),
    // Distinct deduction categories claimed via monthly_expenses in the
    // current tax year. Counting at app level rather than DB level so we
    // don't need a dedicated RPC just for one number.
    admin
      .from("monthly_expenses")
      .select("category_code")
      .eq("company_id", companyId)
      .eq("tax_year", taxYear),
  ]);

  const { totalTx, triagedTx } = bank;
  const categoriesUsed = new Set(
    (catRows ?? []).map((r) => r.category_code as string),
  ).size;

  const coverage = Math.min(categoriesUsed / TARGET_CATEGORIES, 1);
  const hasBankFeed = totalTx > 0;
  let score: number;
  if (hasBankFeed) {
    const engagement = triagedTx / totalTx;
    score = Math.round((engagement * 0.5 + coverage * 0.5) * 100);
  } else {
    score = Math.round(coverage * 100);
  }

  return {
    score,
    triagedTx,
    totalTx,
    categoriesUsed,
    targetCategories: TARGET_CATEGORIES,
    hasBankFeed,
  };
}
