import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Device-state heartbeat (reliability plan, workstream C). The tracker
 * reports its OWN view of health — toggle state, buffer depth, seconds
 * since the last native callback, flush failure streak, and (once the
 * native DeviceStatus plugin ships) the actual location-authorization
 * level. This turns "the server infers death from hours of GPS silence"
 * into "the device says the toggle is ON but the watcher is dead",
 * which the finalize cron converts into an immediate push instead of a
 * 3-hour-floor one.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const companyId = typeof body.companyId === "string" ? body.companyId : "";
  if (!companyId) {
    return NextResponse.json({ error: "missing_company" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: membership } = await admin
    .from("company_members")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const str = (k: string, max = 40) =>
    typeof body[k] === "string" ? (body[k] as string).slice(0, max) : null;
  const num = (k: string) =>
    typeof body[k] === "number" && Number.isFinite(body[k])
      ? Math.max(0, Math.round(body[k] as number))
      : null;

  const { error } = await admin.from("mileage_device_status").upsert(
    {
      driver_user_id: user.id,
      company_id: companyId,
      platform: str("platform"),
      app_version: str("appVersion"),
      tracking_enabled: body.trackingEnabled === true,
      buffer_size: num("bufferSize") ?? 0,
      last_cb_age_s: num("lastCbAgeS"),
      fail_streak: num("failStreak") ?? 0,
      location_authorization: str("locationAuthorization", 20),
      precise_location:
        typeof body.preciseLocation === "boolean" ? body.preciseLocation : null,
      battery_optimized:
        typeof body.batteryOptimized === "boolean" ? body.batteryOptimized : null,
      low_power_mode:
        typeof body.lowPowerMode === "boolean" ? body.lowPowerMode : null,
      reported_at: new Date().toISOString(),
    },
    { onConflict: "driver_user_id,company_id" },
  );
  if (error) {
    console.error("[heartbeat] upsert failed", error.message);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
