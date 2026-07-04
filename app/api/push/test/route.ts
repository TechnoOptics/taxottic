import { NextResponse } from "next/server";
import {
  createClient,
  createServiceClient,
} from "@/lib/supabase/server";
import { notify } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/push/test
//
// Fires a one-off test push to the calling user. Useful for verifying
// FCM/APNs credentials AFTER the user provisions them in Vercel, no
// real drive required.
//
// Returns a structured diagnostic so the UI can show EXACTLY what
// failed: provider not configured / no tokens registered / APNs 401
// from invalid key / FCM 404 UNREGISTERED, etc. This is the
// "tell me what's missing" surface the user asked for when push wasn't
// landing on their phone before the demo drive.
//
// Authentication: requires the current session. No admin-mode gate -
// every signed-in user can fire a push to their OWN devices.

type Diagnostic = {
  ok: boolean;
  hint: string;
  tokens: { active: number; revoked: number };
  providers: { apnsConfigured: boolean; fcmConfigured: boolean };
  result?: {
    sent: boolean;
    delivered: number;
    revoked: number;
  };
};

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const { data: tokenRows } = await admin
    .from("device_tokens")
    .select("id, revoked_at")
    .eq("user_id", user.id);
  const tokens = {
    active: (tokenRows ?? []).filter((r) => r.revoked_at === null).length,
    revoked: (tokenRows ?? []).filter((r) => r.revoked_at !== null).length,
  };

  const providers = {
    apnsConfigured: !!(
      process.env.APNS_KEY_ID &&
      process.env.APNS_TEAM_ID &&
      process.env.APNS_PRIVATE_KEY &&
      process.env.APNS_BUNDLE_ID
    ),
    fcmConfigured: !!process.env.FCM_SERVICE_ACCOUNT_JSON,
  };

  // Decide WHY the user might not see a banner, in priority order.
  // This is the "honest error UX" the user asked for, short, specific.
  let hint = "";
  if (!providers.apnsConfigured && !providers.fcmConfigured) {
    hint =
      "No push provider configured in Vercel. Set FCM_SERVICE_ACCOUNT_JSON (Android) and/or APNS_KEY_ID + APNS_TEAM_ID + APNS_PRIVATE_KEY + APNS_BUNDLE_ID (iOS), then redeploy. See docs/PUSH_NOTIFICATIONS_SETUP.md.";
  } else if (tokens.active === 0 && tokens.revoked === 0) {
    hint =
      "No device tokens registered yet. Open the Taxottic native app on your phone, accept the Notifications prompt, and ensure NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED=1 in Vercel (then redeploy so the gate flag bakes into the JS bundle).";
  } else if (tokens.active === 0) {
    hint =
      "All your device tokens are revoked (the provider rejected them on a previous send, usually means the app was uninstalled or signed out). Reopen the Taxottic native app on your phone to re-register.";
  }

  // Use the existing trip_logged payload kind for the test, privacy-
  // compliant body, dedupe key uses the timestamp so a second test
  // call goes through (instead of being silently de-duped).
  const tripId = `test-${Date.now()}`;
  const result = await notify(user.id, {
    kind: "trip_logged",
    tripId,
    classification: "business",
  });

  const diag: Diagnostic = {
    ok: result.delivered > 0,
    hint:
      hint ||
      (result.delivered > 0
        ? "Push sent. If you don't see a banner: check Do Not Disturb / Focus mode, and make sure notifications are enabled in OS Settings → Taxottic."
        : `Provider returned delivered=${result.delivered}, revoked=${result.revoked}. Vercel logs will have a [push] line with more detail.`),
    tokens,
    providers,
    result,
  };
  return NextResponse.json(diag);
}
