import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/push/register  { token, platform: 'ios'|'android'|'web' }
//
// The native shell calls this from the @capacitor/push-notifications
// 'registration' listener on every cold start. Auth via session, then
// upsert via the service-role client scoped to the validated user
// (the codebase's standard route pattern, @supabase/ssr cookies
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

  let body: {
    token?: unknown;
    platform?: unknown;
    failure?: unknown;
    status?: unknown;
    appVersion?: unknown;
  };
  try {
    body = (await req.json()) as {
      token?: unknown;
      platform?: unknown;
      failure?: unknown;
      status?: unknown;
      appVersion?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const platform =
    typeof body.platform === "string" ? body.platform : "";

  // A registration FAILURE report carries no token, by definition. It
  // used to be discarded on the client (an empty registrationError
  // handler), which is how an iOS device went a month with no row in
  // device_tokens and no way to tell whether the cause was a missing
  // entitlement, a declined prompt, or a plugin missing from the
  // binary. Log it against the validated user so the answer exists
  // somewhere. Never 400 on it: a rejected diagnostic teaches the
  // client to stop reporting.
  const failure =
    typeof body.failure === "string" ? body.failure.slice(0, 300) : "";
  const status = typeof body.status === "string" ? body.status.slice(0, 40) : "";
  const appVersion =
    typeof body.appVersion === "string" ? body.appVersion.slice(0, 40) : null;

  // Persist the outcome, don't just log it. The console.log this
  // replaces went to Vercel runtime logs, which were unreadable for a
  // whole debugging session while PostgREST answered every time. Store
  // it where it can actually be queried.
  //
  // Every branch reports, not only the error one. A device that never
  // reaches register() (plugin absent, flag off, permission refused)
  // previously said NOTHING, which is indistinguishable from a device
  // nobody ever looked at — and that ambiguity is precisely why iOS went
  // a month unexplained.
  if (!token && (failure || status)) {
    const plat = PLATFORMS.has(platform) ? platform : "unknown";
    const admin = createServiceClient();
    const nowIso = new Date().toISOString();
    // Read-then-write so `attempts` counts cold starts. A racing double
    // report costs one increment, which does not change any conclusion
    // drawn from this table.
    const { data: prior } = await admin
      .from("push_registration_state")
      .select("attempts, status")
      .eq("user_id", user.id)
      .eq("platform", plat)
      .maybeSingle();
    await admin.from("push_registration_state").upsert(
      {
        user_id: user.id,
        platform: plat,
        status: status || "registration_error",
        detail: failure || null,
        app_version: appVersion,
        attempts: (prior?.attempts ?? 0) + 1,
        last_seen_at: nowIso,
        ...(prior ? {} : { first_seen_at: nowIso }),
      },
      { onConflict: "user_id,platform" },
    );
    return NextResponse.json({ ok: true, recorded: status || "failure" });
  }

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

  // Record success too, so the state table distinguishes "this device
  // registered" from "this device has never reported anything". Without
  // the success row, a healthy device and an unreachable one both read
  // as an absent row, which is the ambiguity this whole table exists to
  // remove. Best-effort: a diagnostic write must never fail a
  // registration that already succeeded.
  try {
    const nowIso = new Date().toISOString();
    const { data: prior } = await admin
      .from("push_registration_state")
      .select("attempts")
      .eq("user_id", user.id)
      .eq("platform", platform)
      .maybeSingle();
    await admin.from("push_registration_state").upsert(
      {
        user_id: user.id,
        platform,
        status: "registered",
        detail: null,
        app_version: appVersion,
        attempts: (prior?.attempts ?? 0) + 1,
        last_seen_at: nowIso,
        ...(prior ? {} : { first_seen_at: nowIso }),
      },
      { onConflict: "user_id,platform" },
    );
  } catch {
    /* diagnostics are never allowed to break the real path */
  }
  return NextResponse.json({ ok: true });
}
