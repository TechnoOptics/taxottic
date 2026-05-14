import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Tier 3 #4: firm_activity_log retention cron.
 *
 * The activity log is append-only and tends to grow without bound:
 * every page load on a tenant audit surface, every document
 * generation, every invoice send, every signature event — they
 * all land in `firm_activity_log`. We keep the last `RETENTION_DAYS`
 * rows for hot-query performance; older rows are bulk-deleted on
 * the nightly cron schedule.
 *
 * Why we don't ARCHIVE first:
 *   - We're not legally required to retain firm-internal activity
 *     beyond the relevant engagement's audit period.
 *   - Tenants who need pre-retention rows can be granted ad-hoc
 *     access via super-admin queries against PITR snapshots.
 *   - Keeping the live table lean keeps `getUnreadActivityCount`
 *     and inbox queries fast.
 *
 * Override:
 *   Set FIRM_ACTIVITY_RETENTION_DAYS in the environment to tune.
 *   Default 365 days — covers a full tax cycle plus a buffer for
 *   amended returns.
 *
 * Auth: same envelope as other crons (Vercel x-vercel-cron OR
 * Authorization: Bearer $CRON_SECRET).
 */

const DEFAULT_RETENTION_DAYS = 365;
const BATCH_LIMIT = 5000;

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

  const retentionDaysRaw = Number(
    process.env.FIRM_ACTIVITY_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS,
  );
  const retentionDays =
    Number.isFinite(retentionDaysRaw) && retentionDaysRaw >= 30
      ? Math.floor(retentionDaysRaw)
      : DEFAULT_RETENTION_DAYS;

  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const cutoffIso = cutoff.toISOString();

  const admin = createServiceClient();

  // Two-step delete: first we look up the IDs older than cutoff,
  // capped at BATCH_LIMIT, then we DELETE by id. Using LIMIT
  // directly on DELETE isn't supported in the supabase-js builder,
  // and an unbounded DELETE on a 5M-row table would lock too much.
  const { data: stale, error: selectErr } = await admin
    .from("firm_activity_log")
    .select("id")
    .lt("created_at", cutoffIso)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);
  if (selectErr) {
    return NextResponse.json(
      { error: selectErr.message },
      { status: 500 },
    );
  }

  const ids = (stale ?? []).map((r) => r.id);
  let deleted = 0;
  if (ids.length > 0) {
    const { error: delErr, count } = await admin
      .from("firm_activity_log")
      .delete({ count: "exact" })
      .in("id", ids);
    if (delErr) {
      return NextResponse.json(
        { error: delErr.message },
        { status: 500 },
      );
    }
    deleted = count ?? ids.length;
  }

  return NextResponse.json({
    status: "ok",
    retention_days: retentionDays,
    cutoff: cutoffIso,
    deleted,
    has_more: ids.length >= BATCH_LIMIT,
  });
}
