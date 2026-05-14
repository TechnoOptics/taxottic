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
const MIN_RETENTION_DAYS = 30;
const BATCH_LIMIT = 5000;
const WALL_BUDGET_MS = 4 * 60 * 1000; // 4 of 5 min Vercel ceiling

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
    Number.isFinite(retentionDaysRaw) && retentionDaysRaw >= MIN_RETENTION_DAYS
      ? Math.floor(retentionDaysRaw)
      : DEFAULT_RETENTION_DAYS;

  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const cutoffIso = cutoff.toISOString();

  const admin = createServiceClient();
  const startMs = Date.now();

  let deleted = 0;
  let batches = 0;
  let hadMore = false;

  // Loop in BATCH_LIMIT chunks until either we drain the backlog
  // or we hit the wall budget. Two-step inside each chunk:
  // SELECT ids then DELETE WHERE id IN (...), because the
  // supabase-js builder doesn't expose LIMIT on DELETE and an
  // unbounded DELETE on a multi-million-row table would lock too
  // much.
  while (true) {
    if (Date.now() - startMs > WALL_BUDGET_MS) {
      hadMore = true;
      break;
    }

    const { data: stale, error: selectErr } = await admin
      .from("firm_activity_log")
      .select("id")
      .lt("created_at", cutoffIso)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (selectErr) {
      return NextResponse.json(
        {
          status: "error",
          error: selectErr.message,
          deleted,
          batches,
        },
        { status: 500 },
      );
    }

    const ids = (stale ?? []).map((r) => r.id);
    if (ids.length === 0) break;

    const { error: delErr, count } = await admin
      .from("firm_activity_log")
      .delete({ count: "exact" })
      .in("id", ids);
    if (delErr) {
      return NextResponse.json(
        {
          status: "error",
          error: delErr.message,
          deleted,
          batches,
        },
        { status: 500 },
      );
    }

    deleted += count ?? ids.length;
    batches++;
    if (ids.length < BATCH_LIMIT) break; // drained
  }

  return NextResponse.json({
    status: "ok",
    retention_days: retentionDays,
    cutoff: cutoffIso,
    deleted,
    batches,
    has_more: hadMore,
    duration_ms: Date.now() - startMs,
  });
}
