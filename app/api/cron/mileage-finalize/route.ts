import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { finalizeUserTrips, reconcileBrokenTrips } from "@/lib/mileage/finalize";
import { evaluateTrackerStall, WATCH_WINDOW_MS } from "@/lib/mileage/stall";
import {
  evaluateDriveTrackingHealth,
  MOVEMENT_SPEED_MPS,
} from "@/lib/mileage/device-health";
import { notify } from "@/lib/push";
import {
  evaluateFleetCapture,
  MIN_BASELINE_DAYS,
} from "@/lib/mileage/fleet-canary";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Mileage finalizer cron.
 *
 * Why this exists: a trip only materialises when an ingest call sees the
 * user has parked (last staged point >5 min old). That detection rides
 * on the device's background heartbeats, so when the app is
 * backgrounded or killed right after a drive, the heartbeats stop and
 * the just-finished drive sits OPEN in mileage_points_raw, never closing.
 * And because the live ingest only looks back ~24h, any such drive ages
 * out of that window and is stranded forever (lost mileage + deduction).
 *
 * This cron is the server-side safety net: every 10 minutes it finds
 * every driver/company with unconsumed staging points and runs the same
 * segmentation finalizer over a WIDE window. forceClose=false, so it
 * only closes trips whose last point is genuinely >5 min old, it can
 * never sever a drive that's still in progress. push=false so a one-time
 * backfill of weeks of stranded drives doesn't spam the lock screen.
 *
 * Auth: Vercel sets `x-vercel-cron: 1` on scheduled runs; we also accept
 * Authorization: Bearer $CRON_SECRET for manual/debug triggering.
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

  // Collect the distinct (driver, company) pairs that have unconsumed
  // staging points. Page through so a large backlog can't hide a pair
  // past the PostgREST 1000-row cap. Only 2 columns, so this is cheap.
  const pairs = new Map<string, { driver: string; company: string }>();
  const PAGE = 1000;
  const SCAN_CAP = 50_000;
  // Same 45-day floor the finalizer itself uses. Without it the scan
  // walked the 50,000 OLDEST unconsumed rows first — permanently
  // stationary residue that will never segment — so a busy fleet could
  // saturate the cap on ancient noise and never reach today's drivers
  // (audit #32). Saturation is logged loudly below.
  const scanSinceIso = new Date(Date.now() - 45 * 24 * 60 * 60_000).toISOString();
  let scanSaturated = false;
  for (let from = 0; from < SCAN_CAP; from += PAGE) {
    const { data, error } = await admin
      .from("mileage_points_raw")
      .select("driver_user_id, company_id")
      .is("consumed_at", null)
      .gte("captured_at", scanSinceIso)
      .order("captured_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[mileage-finalize] pair scan failed", error.message);
      break;
    }
    const rows = data ?? [];
    for (const r of rows) {
      const driver = r.driver_user_id as string;
      const company = r.company_id as string;
      pairs.set(`${driver}|${company}`, { driver, company });
    }
    if (rows.length < PAGE) break;
    if (from + PAGE >= SCAN_CAP) scanSaturated = true;
  }
  if (scanSaturated) {
    console.error(
      `[mileage-finalize] SCAN CAP HIT (${SCAN_CAP}): some drivers may not have been finalized this tick. Raise SCAN_CAP or tighten retention.`,
    );
  }

  // Finalize each. Wide window (45 days) so drives stranded well beyond
  // the live ingest's 24h bound are recovered. Each call segments only
  // that user's pool and dedupes against existing trips by overlap, so a
  // re-run is idempotent.
  const sinceIso = new Date(
    Date.now() - 45 * 24 * 60 * 60_000,
  ).toISOString();
  let totalTrips = 0;
  let processed = 0;
  for (const { driver, company } of pairs.values()) {
    try {
      const r = await finalizeUserTrips(admin, driver, company, {
        sinceIso,
        forceClose: false,
        push: false,
      });
      totalTrips += r.tripsCreated;
      processed++;
    } catch (err) {
      console.error(
        "[mileage-finalize] finalize failed",
        driver,
        company,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // ── Self-healing reconcile ───────────────────────────────────────
  // Catch any trip left with a "straight line across no road" gap (its
  // window holds more usable raw points than were drawn) and rebuild it
  // from the raw window. Idempotent + never-shrink, so healthy trips are
  // untouched; a future regression self-heals within one cron interval.
  // Wrapped so a reconcile failure can never break finalization.
  let healed = 0;
  try {
    const reconcile = await reconcileBrokenTrips(admin, {
      sinceIso: new Date(Date.now() - 45 * 24 * 60 * 60_000).toISOString(),
      limit: 200,
    });
    healed = reconcile.healed;
    if (reconcile.scanned > 0) {
      console.log(
        `[mileage-finalize] reconcile scanned=${reconcile.scanned} healed=${reconcile.healed}`,
      );
    }
  } catch (err) {
    console.error(
      "[mileage-finalize] reconcile failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  // ── Tracker-stall escalation ─────────────────────────────────────
  // A driver who WAS uploading (any point in the watch window) and has
  // now been silent for hours has a dead tracker — in practice iOS
  // reverting Location "Always" → "While Using" (observed twice on a
  // real device). The in-app banner can't reach a closed app, so the
  // escalation is a push. Pure decision logic in lib/mileage/stall.ts;
  // episode state in mileage_tracker_alerts (service-role only).
  let stallsNotified = 0;
  let stallsUndeliverable = 0;
  let parkedNotified = 0;
  try {
    const nowMs = Date.now();
    const watchSinceIso = new Date(nowMs - WATCH_WINDOW_MS).toISOString();
    // Distinct (driver, company) with ANY upload in the watch window —
    // deliberately not the unconsumed-pairs set above, which can miss a
    // driver whose points were all consumed before the tracker died.
    const watched = new Map<string, { driver: string; company: string }>();
    for (let from = 0; from < SCAN_CAP; from += PAGE) {
      const { data, error } = await admin
        .from("mileage_points_raw")
        .select("driver_user_id, company_id")
        .gte("created_at", watchSinceIso)
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      for (const r of data) {
        const driver = r.driver_user_id as string;
        const company = r.company_id as string;
        watched.set(`${driver}|${company}`, { driver, company });
      }
      if (data.length < PAGE) break;
    }

    for (const { driver, company } of watched.values()) {
      const { data: newest } = await admin
        .from("mileage_points_raw")
        .select("created_at")
        .eq("driver_user_id", driver)
        .eq("company_id", company)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!newest) continue;
      const lastUploadMs = Date.parse(newest.created_at as string);

      const { data: alert } = await admin
        .from("mileage_tracker_alerts")
        .select("notified_at, delivery_failed_at")
        .eq("driver_user_id", driver)
        .eq("company_id", company)
        .eq("kind", "silent")
        .maybeSingle();

      // An undeliverable episode leaves notified_at NULL on purpose, so
      // the sweep keeps trying instead of going quiet. Without a floor
      // that means a fresh attempt every 10 minutes forever; the dedupe
      // claim makes each one cheap, but it is still noise. Retry hourly.
      const failedAt = alert?.delivery_failed_at
        ? Date.parse(alert.delivery_failed_at as string)
        : null;
      if (
        alert?.notified_at == null &&
        failedAt != null &&
        nowMs - failedAt < 60 * 60_000
      ) {
        continue;
      }

      const decision = evaluateTrackerStall({
        lastUploadMs,
        nowMs,
        lastNotifiedMs: alert
          ? Date.parse(alert.notified_at as string)
          : null,
      });

      // Device-truth escalation (workstream C): the app's heartbeat can
      // prove the tracker is dead LONG before the 3h GPS-silence floor —
      // "toggle ON but no native callback for 30+ min" or (once the
      // native plugin reports it) "authorization degraded from Always".
      // Only trust a FRESH heartbeat (<15 min): a stale one just means
      // the app is closed, which is the silence alarm's job, not ours.
      let deviceStall = false;
      if (decision !== "notify") {
        const { data: ds } = await admin
          .from("mileage_device_status")
          .select(
            "tracking_enabled, last_cb_age_s, location_authorization, reported_at",
          )
          .eq("driver_user_id", driver)
          .eq("company_id", company)
          .maybeSingle();
        if (
          ds &&
          ds.tracking_enabled === true &&
          nowMs - Date.parse(ds.reported_at as string) < 15 * 60_000
        ) {
          const cbAge = (ds.last_cb_age_s as number | null) ?? null;
          const auth = (ds.location_authorization as string | null) ?? null;
          deviceStall =
            (cbAge != null && cbAge > 1800) ||
            (auth != null && auth !== "always");
        }
        if (deviceStall) {
          const lastNotified = alert
            ? Date.parse(alert.notified_at as string)
            : null;
          if (lastNotified != null && nowMs - lastNotified < 24 * 60 * 60_000) {
            deviceStall = false; // already told them this episode
          }
        }
      }

      if (decision === "clear" && !deviceStall) {
        if (alert) {
          await admin
            .from("mileage_tracker_alerts")
            .delete()
            .eq("driver_user_id", driver)
            .eq("company_id", company)
            .eq("kind", "silent");
        }
        continue;
      }
      if (decision !== "notify" && !deviceStall) continue;

      const dayKey = new Date(nowMs).toISOString().slice(0, 10);
      const res = await notify(driver, { kind: "tracker_stalled", dayKey });

      // Whether the driver was actually REACHED, not merely whether we
      // tried. This row used to record notified_at unconditionally, so a
      // driver with no registered device looked notified forever: the
      // episode was marked handled, the 24h re-notify kept resetting the
      // timestamp, and nobody learned that nothing had been delivered.
      // Measured on a real iOS device that sat dark from Aug 4 to Aug 6
      // 2026 with zero rows in device_tokens.
      //
      // delivered === 0 covers both "no device registered" and "every
      // token failed". sent === false means the dedupe claim was already
      // held, i.e. this episode was delivered on an earlier tick, so it
      // is NOT an unreachable driver.
      const reached = res.delivered > 0;
      let escalatedAt: string | null = null;

      // Escalate whenever this episode has NO record of ever reaching the
      // driver. Deliberately not gated on res.sent: sent === false means
      // the dedupe claim was already held, which happens on the very
      // ticks that matter — the first attempt claims the key, delivers to
      // nobody, and every later tick then reports sent:false, delivered:0.
      // Gating on res.sent would have made the escalation unreachable for
      // the rest of the day, i.e. silent in exactly the case it exists
      // for. The manager notify carries its own per-driver-per-day dedupe
      // key, so re-entering here cannot produce a second nudge.
      if (!reached && alert?.notified_at == null) {
        // Last resort: tell the managers. A driver we cannot reach is
        // invisible to every other channel, because the in-app banner
        // needs the app open and the push needs a registered device.
        try {
          const { data: mgrs } = await admin
            .from("company_members")
            .select("user_id, role")
            .eq("company_id", company)
            .in("role", ["manager", "lead"]);
          const { data: who } = await admin
            .from("profiles")
            .select("full_name")
            .eq("id", driver)
            .maybeSingle();
          // Never leak an email or an id into a notification body.
          const driverLabel =
            (who?.full_name as string | null)?.trim() || "A driver";
          let anyManagerReached = false;
          for (const m of mgrs ?? []) {
            const mid = m.user_id as string;
            if (mid === driver) continue; // don't tell them about themselves
            const r = await notify(mid, {
              kind: "driver_tracker_unreachable",
              driverLabel,
              driverId: driver,
              dayKey,
            });
            if (r.delivered > 0) anyManagerReached = true;
          }
          if (anyManagerReached) escalatedAt = new Date(nowMs).toISOString();
        } catch (e) {
          // An escalation failure must not abort the sweep for every
          // other driver behind this one.
          console.log(
            `[mileage-finalize] manager escalation failed driver=${driver}: ${
              (e as Error)?.message ?? "unknown"
            }`,
          );
        }
      }

      await admin.from("mileage_tracker_alerts").upsert(
        {
          driver_user_id: driver,
          company_id: company,
          kind: "silent",
          stalled_since: new Date(lastUploadMs).toISOString(),
          // Only stamp notified_at when the driver was genuinely
          // reached. Leaving it null on a failed delivery is what makes
          // the next tick try again instead of going quiet, and what
          // makes "we told them" auditable rather than assumed.
          notified_at: reached ? new Date(nowMs).toISOString() : null,
          delivery_failed_at: reached ? null : new Date(nowMs).toISOString(),
          escalated_at: escalatedAt,
        },
        { onConflict: "driver_user_id,company_id,kind" },
      );
      if (reached) stallsNotified++;
      else stallsUndeliverable++;
    }

    // ── Parked-device escalation ──────────────────────────────────
    // The OTHER way tracking silently loses drives: the device reports
    // like clockwork but never moves, i.e. Taxottic runs on a phone
    // that is not the one being driven (observed for real: a Fold
    // uploading on schedule while parked for 3 days as drives went
    // untracked). Silence-based detection can never catch this, the
    // device is not silent. Same episode machinery as the silent
    // sweep, under kind='parked', with a slower 72h renotify since
    // the fix (move tracking to the right phone) is not instant.
    const PARKED_RENOTIFY_MS = 72 * 60 * 60_000;
    for (const { driver, company } of watched.values()) {
      const { data: newest } = await admin
        .from("mileage_points_raw")
        .select("created_at")
        .eq("driver_user_id", driver)
        .eq("company_id", company)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!newest) continue;
      const lastUploadMs = Date.parse(newest.created_at as string);

      const { data: moved } = await admin
        .from("mileage_points_raw")
        .select("created_at")
        .eq("driver_user_id", driver)
        .eq("company_id", company)
        .gte("speed_mps", MOVEMENT_SPEED_MPS)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const health = evaluateDriveTrackingHealth({
        nowMs,
        lastUploadMs,
        lastMovementMs: moved
          ? Date.parse(moved.created_at as string)
          : null,
        // The watched set only contains uploading devices; intent is
        // irrelevant here (an uploading device IS tracking).
        trackingEnabled: true,
      });

      const { data: parkedAlert } = await admin
        .from("mileage_tracker_alerts")
        .select("notified_at")
        .eq("driver_user_id", driver)
        .eq("company_id", company)
        .eq("kind", "parked")
        .maybeSingle();

      if (health.status !== "parked") {
        // Movement returned (or the device went silent, which is the
        // silent sweep's episode, not ours): close the parked episode
        // so the next one notifies fresh.
        if (parkedAlert) {
          await admin
            .from("mileage_tracker_alerts")
            .delete()
            .eq("driver_user_id", driver)
            .eq("company_id", company)
            .eq("kind", "parked");
        }
        continue;
      }

      const lastNotified = parkedAlert
        ? Date.parse(parkedAlert.notified_at as string)
        : null;
      if (lastNotified != null && nowMs - lastNotified < PARKED_RENOTIFY_MS) {
        continue;
      }

      await notify(driver, {
        kind: "tracker_parked",
        dayKey: new Date(nowMs).toISOString().slice(0, 10),
      });
      await admin.from("mileage_tracker_alerts").upsert(
        {
          driver_user_id: driver,
          company_id: company,
          kind: "parked",
          stalled_since: new Date(
            nowMs - (health.ageMs ?? 0),
          ).toISOString(),
          notified_at: new Date(nowMs).toISOString(),
        },
        { onConflict: "driver_user_id,company_id,kind" },
      );
      parkedNotified++;
    }
  } catch (err) {
    // The sweep must never break trip finalization.
    console.error(
      "[mileage-finalize] stall sweep failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  // ── Fleet capture canary ──────────────────────────────────────
  // Per-driver alerts catch ONE device failing. They cannot see the
  // failure that actually cost us the most: capture degrading for
  // EVERYONE at once (a bad deploy, a token change, a schema
  // regression), where no single device looks anomalous. Every such
  // incident so far was found by a human noticing missing drives days
  // later. This compares the fleet against its own recent past.
  //
  // Runs once per tick but only ACTS on a state change, so a persistent
  // outage doesn't spam the log every 10 minutes.
  let fleetStatus: string = "ok";
  try {
    const { data: rows } = await admin
      .from("mileage_points_raw")
      .select("driver_user_id, captured_at")
      .gte(
        "captured_at",
        new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString(),
      )
      .limit(200_000);
    const byDay = new Map<string, { pts: number; drivers: Set<string> }>();
    for (const r of rows ?? []) {
      const d = new Date(r.captured_at as string).toISOString().slice(0, 10);
      const e = byDay.get(d) ?? { pts: 0, drivers: new Set<string>() };
      e.pts++;
      e.drivers.add(r.driver_user_id as string);
      byDay.set(d, e);
    }
    const { data: tripRows } = await admin
      .from("mileage_trips")
      .select("started_at")
      .gte(
        "started_at",
        new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString(),
      )
      .limit(50_000);
    const tripsByDay = new Map<string, number>();
    for (const t of tripRows ?? []) {
      const d = new Date(t.started_at as string).toISOString().slice(0, 10);
      tripsByDay.set(d, (tripsByDay.get(d) ?? 0) + 1);
    }
    const days = [...byDay.keys()].sort();
    if (days.length >= MIN_BASELINE_DAYS + 1) {
      const toDay = (d: string) => ({
        day: d,
        points: byDay.get(d)?.pts ?? 0,
        activeDrivers: byDay.get(d)?.drivers.size ?? 0,
        trips: tripsByDay.get(d) ?? 0,
      });
      // Judge the most recent COMPLETE day, so a partial today never
      // looks like a collapse.
      const todayIso = new Date().toISOString().slice(0, 10);
      const complete = days.filter((d) => d < todayIso);
      if (complete.length >= MIN_BASELINE_DAYS + 1) {
        const subject = complete[complete.length - 1];
        const baseline = complete.slice(0, -1).map(toDay);
        const verdict = evaluateFleetCapture(toDay(subject), baseline);
        fleetStatus = verdict.status;
        if (verdict.status !== "ok") {
          console.error(
            `[mileage-finalize] FLEET ${verdict.status.toUpperCase()}: ${verdict.reason}`,
          );
        }
      }
    }
  } catch (err) {
    // The canary must never break finalization.
    console.error(
      "[mileage-finalize] fleet canary failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  console.log(
    `[mileage-finalize] pairs=${pairs.size} processed=${processed} tripsCreated=${totalTrips} healed=${healed} stallsNotified=${stallsNotified} stallsUndeliverable=${stallsUndeliverable} parkedNotified=${parkedNotified} fleet=${fleetStatus}`,
  );

  return NextResponse.json({
    ok: true,
    pairs: pairs.size,
    processed,
    tripsCreated: totalTrips,
    healed,
    fleet: fleetStatus,
  });
}
