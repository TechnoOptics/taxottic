import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/push/register  { token, platform: 'ios'|'android'|'web' }
//
// The native shell calls this from the @capacitor/push-notifications
// 'registration' listener on every cold start. Auth via session, then
// upsert via the service-role client scoped to the validated user
// (the codebase's standard route pattern — @supabase/ssr cookies
// don't reach PostgREST in a route handler). Idempotent on
// (user_id, token): a re-register refreshes last_seen_at and clears
// any prior revoked_at so a recovered token resumes delivery.

const PLATFORMS = new Set(["ios", "android", "web"]);

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { token?: unknown; platform?: unknown };
  try {
    body = (await req.json()) as { token?: unknown; platform?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const platform =
    typeof body.platform === "string" ? body.platform : "";
  if (!token || token.length > 4096 || !PLATFORMS.has(platform)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { error } = await admin.from("device_tokens").upsert(
    {
      user_id: user.id,
      token,
      platform,
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
    },
    { onConflict: "user_id,token" },
  );
  if (error) {
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
