import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/watch/pair/poll?deviceId=…  (unauthenticated, the watch
// has no token yet; possession of the freshly-issued deviceId is the
// only thing it can present). While unbound: { paired:false }. Once
// the phone has redeemed, returns the token EXACTLY ONCE and clears
// pending_token immediately, so the plaintext never lingers and a
// second poll can't re-read it.
export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("deviceId");
  if (!deviceId) {
    return NextResponse.json({ error: "missing_device" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: device } = await admin
    .from("watch_devices")
    .select("id,user_id,pending_token,revoked_at")
    .eq("id", deviceId)
    .maybeSingle();

  if (!device || device.revoked_at) {
    return NextResponse.json({ error: "unknown_device" }, { status: 404 });
  }
  if (!device.user_id || !device.pending_token) {
    return NextResponse.json({ paired: false });
  }

  const token = device.pending_token as string;
  // Clear before responding, single delivery. If this update fails
  // we do NOT hand out the token (avoid a re-readable plaintext).
  const { data: cleared } = await admin
    .from("watch_devices")
    .update({ pending_token: null, last_seen_at: new Date().toISOString() })
    .eq("id", device.id)
    .not("pending_token", "is", null)
    .select("id")
    .maybeSingle();
  if (!cleared) {
    return NextResponse.json({ paired: false });
  }

  return NextResponse.json({ paired: true, token });
}
