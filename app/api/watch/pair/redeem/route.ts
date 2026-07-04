import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  hashPairCode,
  mintWatchToken,
  normalizePairCode,
} from "@/lib/watch/pair-crypto";
import { checkRateLimit, clientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/watch/pair/redeem  { code }
//
// The signed-in PHONE calls this from Settings → Devices after the
// user types the 6-digit code shown on the watch. Session auth -
// the account the watch joins is whoever is signed in here, so the
// code itself never carries a credential. Validates the code is
// real, unexpired and unconsumed, binds the device to this user,
// mints the watch token (only its hash is kept) and parks the
// plaintext for one delivery via /pair/poll. Single-use.
//
// 6-digit codes only have ~20 bits of entropy, so we cap attempts
// at 5/min per IP AND per signed-in user. With a 120s code lifetime
// that's ~10 brute-force tries per code window, well below the
// ~10⁻⁵ guess probability we tolerate.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Two-axis throttle: per-IP catches a script hitting the endpoint
  // from one box; per-user catches the case where an attacker rotates
  // IPs but stays signed in. Either axis tripping returns 429.
  const ipOk = checkRateLimit(`watch-pair-redeem:ip:${clientKey(req)}`, {
    capacity: 5,
    refillPerMinute: 5,
  });
  const userOk = checkRateLimit(`watch-pair-redeem:user:${user.id}`, {
    capacity: 5,
    refillPerMinute: 5,
  });
  if (!ipOk || !userOk) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { code?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  // Strip non-digits so "012-345" / "012 345" / "012345" all hash
  // to the same row. Must be exactly six digits.
  const code = normalizePairCode(String(body.code ?? ""));
  if (code.length !== 6) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: row } = await admin
    .from("watch_pair_codes")
    .select("id,device_id,expires_at,consumed_at")
    .eq("code_hash", hashPairCode(code))
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "invalid_code" }, { status: 404 });
  }
  if (row.consumed_at) {
    return NextResponse.json({ error: "code_used" }, { status: 409 });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "code_expired" }, { status: 410 });
  }

  // Atomically consume: only the first redeemer wins the race.
  const { data: consumed } = await admin
    .from("watch_pair_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (!consumed) {
    return NextResponse.json({ error: "code_used" }, { status: 409 });
  }

  const { token, tokenHash } = mintWatchToken();
  const { error: bindErr } = await admin
    .from("watch_devices")
    .update({
      user_id: user.id,
      token_hash: tokenHash,
      pending_token: token,
    })
    .eq("id", row.device_id);
  if (bindErr) {
    return NextResponse.json({ error: "bind_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
