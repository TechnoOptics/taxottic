import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncPlaidConnection } from "@/lib/plaid/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Hourly cron: sync every active Plaid connection so transactions
 * land in the forecast even if the user never touches the banks page
 * and even if Plaid's webhook gets dropped (which happens on
 * occasion - retries are best-effort).
 *
 * Auth: header `x-vercel-cron` is set by Vercel for scheduled
 * invocations. We additionally accept Authorization: Bearer
 * $CRON_SECRET so the route can be triggered manually for debugging
 * without lying about being Vercel.
 *
 * Throughput: connections are synced sequentially with no per-call
 * timeout; the route's maxDuration of 300s is the only cap. With ~5
 * connections that's plenty. When the connection count grows we'll
 * batch by `last_synced_at` and trigger N parallel cron runs.
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

  // Pick connections most overdue for sync first (oldest last_synced_at)
  // so a quota outage doesn't starve the same connection forever.
  const { data: connections, error } = await admin
    .from("bank_connections")
    .select("id, company_id, institution_name, last_synced_at, status, provider")
    .eq("provider", "plaid")
    .in("status", ["active", "pending"])
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{
    id: string;
    institution: string | null;
    ok: boolean;
    error?: string;
    added?: number;
    applied?: number;
  }> = [];
  for (const c of connections ?? []) {
    try {
      const r = await syncPlaidConnection(admin, c.id as string);
      results.push({
        id: c.id as string,
        institution: (c.institution_name as string | null) ?? null,
        ok: true,
        added: r.added,
        applied: r.applied,
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
