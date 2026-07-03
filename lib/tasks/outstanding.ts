import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCents } from "@/lib/tax/forecast";

// Outstanding tasks — the single source of truth for "things the user
// needs to make a quick business/personal or category call on." Three
// surfaces feed from here: the header bell, the on-load popup, the
// slim banner, the push-reminder cron, and (partially) the watch
// glance. One tally means the count shown in the bell always matches
// what the popup lists and what the push nudge claims — no drift.
//
// Sources of "needs a decision":
//   1. mileage_trips        classification = 'unclassified' (this driver)
//   2. bank_transactions    CSV-imported rows not yet applied/ignored
//   3. account_transactions Plaid-synced rows still user_action='pending'
//
// Uses the SESSION-scoped Supabase client (RLS-enforced), matching the
// pattern already used by the banks page and AppHeader — never the
// service-role client, since this always runs on behalf of the
// signed-in user viewing their own data.

export type OutstandingItem = {
  id: string;
  kind: "trip" | "csv_transaction" | "bank_transaction";
  title: string;
  subtitle: string;
  href: string;
};

export type OutstandingTasks = {
  items: OutstandingItem[];
  /** True total across all three sources — NOT capped like `items`. */
  count: number;
};

const MAX_ITEMS = 8;

function monthDayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Tally + preview list of outstanding items for the CURRENT user,
 * scoped to their active company (for the two transaction sources —
 * mileage is scoped to the driver directly, regardless of company).
 *
 * `companyPublicId` may be null (e.g. user has no company yet), in
 * which case the two transaction sources are skipped — mileage trips
 * still surface since they don't require a company context to review.
 */
export async function getOutstandingTasks(
  supabase: SupabaseClient,
  params: { userId: string; companyId: string | null; companyPublicId: string | null },
): Promise<OutstandingTasks> {
  const { userId, companyId, companyPublicId } = params;
  const items: OutstandingItem[] = [];
  let total = 0;

  // 1. Unclassified mileage trips (this driver, any company).
  try {
    const { count } = await supabase
      .from("mileage_trips")
      .select("id", { count: "exact", head: true })
      .eq("driver_user_id", userId)
      .eq("classification", "unclassified");
    total += count ?? 0;

    if ((count ?? 0) > 0) {
      const { data } = await supabase
        .from("mileage_trips")
        .select("id, distance_miles, started_at")
        .eq("driver_user_id", userId)
        .eq("classification", "unclassified")
        .order("started_at", { ascending: false })
        .limit(MAX_ITEMS);
      for (const row of (data ?? []) as Array<{
        id: string;
        distance_miles: number;
        started_at: string;
      }>) {
        items.push({
          id: row.id,
          kind: "trip",
          title: `${Number(row.distance_miles ?? 0).toFixed(1)} mi drive`,
          subtitle: `${monthDayLabel(row.started_at)} · business or personal?`,
          href: `/mileage/classify?trip=${row.id}`,
        });
      }
    }
  } catch {
    /* mileage source unavailable — skip, don't fail the whole tally */
  }

  if (companyId) {
    // 2. CSV-imported bank transactions still needing a category/ignore call.
    try {
      const { count } = await supabase
        .from("bank_transactions")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("ignored", false)
        .is("applied_category_code", null)
        .is("applied_expense_id", null)
        .is("applied_income_id", null);
      total += count ?? 0;

      if ((count ?? 0) > 0 && companyPublicId) {
        const { data } = await supabase
          .from("bank_transactions")
          .select("id, description, amount_cents, posted_at, import_id")
          .eq("company_id", companyId)
          .eq("ignored", false)
          .is("applied_category_code", null)
          .is("applied_expense_id", null)
          .is("applied_income_id", null)
          .order("posted_at", { ascending: false })
          .limit(MAX_ITEMS);
        for (const row of (data ?? []) as Array<{
          id: string;
          description: string | null;
          amount_cents: number;
          posted_at: string;
          import_id: string;
        }>) {
          items.push({
            id: row.id,
            kind: "csv_transaction",
            title: row.description?.trim() || formatCents(row.amount_cents),
            subtitle: `${monthDayLabel(row.posted_at)} · needs a category`,
            href: `/c/${companyPublicId}/import/${row.import_id}?highlight=${row.id}`,
          });
        }
      }
    } catch {
      /* csv-transaction source unavailable — skip */
    }

    // 3. Plaid-synced transactions still pending a business/personal call.
    try {
      const { count } = await supabase
        .from("account_transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_action", "pending");
      total += count ?? 0;

      if ((count ?? 0) > 0 && companyPublicId) {
        const { data } = await supabase
          .from("account_transactions")
          .select("id, description, merchant_name, amount_cents, posted_date")
          .eq("user_action", "pending")
          .order("posted_date", { ascending: false })
          .limit(MAX_ITEMS);
        for (const row of (data ?? []) as Array<{
          id: string;
          description: string | null;
          merchant_name: string | null;
          amount_cents: number;
          posted_date: string;
        }>) {
          items.push({
            id: row.id,
            kind: "bank_transaction",
            title:
              row.merchant_name?.trim() ||
              row.description?.trim() ||
              formatCents(row.amount_cents),
            subtitle: `${monthDayLabel(row.posted_date)} · needs a category`,
            href: `/c/${companyPublicId}/banks?highlight=${row.id}#transactions`,
          });
        }
      }
    } catch {
      /* account-transaction source unavailable — skip */
    }
  }

  // Capped for the preview list (trips, then CSV, then Plaid — each
  // source is already newest-first within itself).
  return { items: items.slice(0, MAX_ITEMS), count: total };
}
