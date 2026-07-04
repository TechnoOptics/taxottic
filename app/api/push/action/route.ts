import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolvePushAction } from "@/lib/push/action-map";
import { reclassifyTripCore } from "@/lib/mileage/reclassify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/push/action  { data: Record<string,string>, actionId }
//
// The native shell calls this from the
// pushNotificationActionPerformed listener when the user taps a
// notification action button (Phase 2's "Business / Personal"). Auth
// via session, a notification action is UNTRUSTED, so we re-validate
// the user and re-authorise the target row inside the shared
// reclassify core exactly as the in-app button does. Unknown actions
// map to { type:"open" } and mutate nothing.

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { data?: Record<string, string>; actionId?: string };
  try {
    body = (await req.json()) as {
      data?: Record<string, string>;
      actionId?: string;
    };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const intent = resolvePushAction(body.data, body.actionId);

  if (intent.type === "reclassify_trip") {
    const admin = createServiceClient();
    const res = await reclassifyTripCore(
      admin,
      user.id,
      intent.tripId,
      intent.classification,
    );
    if (!res.ok) {
      const status =
        res.reason === "forbidden"
          ? 403
          : res.reason === "not_found"
            ? 404
            : res.reason === "invalid"
              ? 400
              : 500;
      return NextResponse.json({ error: res.reason }, { status });
    }
    return NextResponse.json({ ok: true, did: "reclassify_trip" });
  }

  // "open", nothing to mutate; the client foregrounds + routes.
  return NextResponse.json({ ok: true, did: "open" });
}
