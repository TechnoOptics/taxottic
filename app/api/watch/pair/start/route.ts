import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { mintPairCode } from "@/lib/watch/pair-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/watch/pair/start  (unauthenticated, the watch isn't
// linked yet). Creates an unbound device + a single-use ~120s code,
// returns the plaintext code (rendered as the QR) and the deviceId
// the watch then polls. Storing only the code HASH means a DB row is
// not a scannable secret.
const TTL_SEC = 120;

export async function POST() {
  const admin = createServiceClient();

  const { data: device, error: dErr } = await admin
    .from("watch_devices")
    .insert({ label: "Wear OS" })
    .select("id")
    .single();
  if (dErr || !device) {
    return NextResponse.json({ error: "start_failed" }, { status: 500 });
  }

  const { code, codeHash } = mintPairCode();
  const expiresAt = new Date(Date.now() + TTL_SEC * 1000).toISOString();
  const { error: cErr } = await admin.from("watch_pair_codes").insert({
    code_hash: codeHash,
    device_id: device.id,
    expires_at: expiresAt,
  });
  if (cErr) {
    // Don't leave an orphan unbound device lying around.
    await admin.from("watch_devices").delete().eq("id", device.id);
    return NextResponse.json({ error: "start_failed" }, { status: 500 });
  }

  return NextResponse.json({
    deviceId: device.id,
    code,
    expiresInSec: TTL_SEC,
  });
}
