import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Nightly recycle-bin sweep.
 *
 * `purge_expired_recycle_bin()` hard-deletes soft-deleted companies and bank
 * connections whose 30-day grace window has expired. The cutoff is enforced
 * inside the SQL function, so this route cannot delete anything early no
 * matter who calls it.
 *
 * WHY THIS EXISTS
 * ---------------
 * This sweep used to run on the /dashboard render, on every single load, as
 * a blocking `await` before the page could produce a byte. Two problems:
 *
 *   1. Speed. It put an unconditional RPC round trip on the critical path of
 *      the most-visited authenticated page, to do nothing at all on the
 *      overwhelming majority of loads.
 *   2. Correctness. It was a destructive write inside a GET render. A React
 *      server render can be retried or abandoned; hard deletes should not be
 *      attached to one. The behaviour also depended on somebody opening the
 *      dashboard, so an account nobody signed into kept expired rows forever,
 *      which is the opposite of what a retention window is for.
 *
 * The comment on `purgeExpiredRecycleBin` in app/actions/recycle-bin.ts has
 * asked for exactly this cron since it was written. This is that cron; the
 * dashboard call site is gone.
 *
 * Auth: same envelope as the other crons (Vercel x-vercel-cron OR
 * Authorization: Bearer $CRON_SECRET).
 */
export async function GET(req: NextRequest) {
  const isCron = req.headers.get("x-vercel-cron") === "1";
  const auth = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const authorized =
    isCron ||
    (cronSecret &&
      auth.startsWith("Bearer ") &&
      auth.slice("Bearer ".length) === cronSecret);
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startMs = Date.now();
  const admin = createServiceClient();
  const { data, error } = await admin.rpc("purge_expired_recycle_bin");
  if (error) {
    return NextResponse.json(
      { status: "error", error: error.message },
      { status: 500 },
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    status: "ok",
    purged_companies: row?.purged_companies ?? 0,
    purged_bank_connections: row?.purged_bank_connections ?? 0,
    duration_ms: Date.now() - startMs,
  });
}
