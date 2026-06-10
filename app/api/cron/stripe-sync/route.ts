import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncStripeConnection } from "@/lib/stripe-connect/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Weekly cron: walk every active Stripe Connect connection and refresh
 * it (vercel.json schedules this Mondays at 05:00 UTC, staggered after
 * the daily Plaid run at 04:00).
 *
 * Why `force: true`: syncStripeConnection throttles itself to once per
 * calendar month by default (lib/stripe-connect/sync.ts) — the same
 * cost-saving default Plaid uses. Plaid bills per transactions-sync, so
 * monthly is right there; Stripe's balance_transactions API is free per
 * call, so there's no budget reason to throttle. Forcing each weekly
 * pass is what actually delivers the weekly cadence the cadence is named
 * for — without `force` a weekly cron would still only sync once a
 * month. The soft-delete guard inside the sync runs regardless of force,
 * so a disconnected connection is still skipped.
 *
 * Auth: header `x-vercel-cron` is set by Vercel for scheduled
 * invocations. We additionally accept Authorization: Bearer
 * $CRON_SECRET so the route can be triggered manually for debugging
 * without spoofing the Vercel header.
 */
export async function GET(req: NextRequest) {
  const isCron = req.headers.get("x-vercel-cron") === "1";
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  const isAuthed = !!secret && auth === `Bearer ${secret}`;
  if (!isCron && !isAuthed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();

  // Oldest last_synced_at first so a transient failure never starves the
  // same connection forever.
  const { data: connections, error } = await admin
    .from("bank_connections")
    .select("id, company_id, institution_name, last_synced_at, status")
    .eq("provider", "stripe")
    .in("status", ["active", "pending"])
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(100);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{
    id: string;
    institution: string | null;
    ok: boolean;
    error?: string;
    added?: number;
    skipped?: boolean;
  }> = [];
  for (const c of connections ?? []) {
    try {
      const r = await syncStripeConnection(admin, c.id as string, {
        force: true,
      });
      results.push({
        id: c.id as string,
        institution: (c.institution_name as string | null) ?? null,
        ok: true,
        added: r.added,
        skipped: r.skipped,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin
        .from("bank_connections")
        .update({ status: "error", last_error: message })
        .eq("id", c.id);
      results.push({
        id: c.id as string,
        institution: (c.institution_name as string | null) ?? null,
        ok: false,
        error: message,
      });
    }
  }

  return NextResponse.json({
    ran_at: new Date().toISOString(),
    count: results.length,
    results,
  });
}
