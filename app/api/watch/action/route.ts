import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { reclassifyTripCore } from "@/lib/mileage/reclassify";
import { resolveWatchUserId } from "@/lib/watch/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/watch/action
//
// HTTPS fallback for outbound watch actions. The watch normally pushes
// actions to the phone over the Wearable Data Layer, and the phone
// bridge forwards them to /api/watch/confirm. That bridge ONLY works
// when the phone app is alive and the GMS connection is healthy — at
// a live demo, on LTE, or with the phone in the user's pocket, the
// bridge may not be available. This endpoint accepts the same JSON
// the Data Layer payloads carry, authenticated by the watch's bearer
// token (the one PairManager persisted after the 6-digit pair), so
// the swipe ALWAYS resolves to a server write even when no phone is
// nearby. Same end state either path — actions are keyed by row id
// and last write wins.
//
// Body: { type: "confirm", kind: "trip"|"expense"|"income",
//         id: string, decision: "left"|"right" }
//   or  { type: "mileage" | "autoApply" | "open", ... }  — accepted
//        but server-no-op; those actions intrinsically need the phone
//        (start GPS, flip a local pref, open a route). We 200 so the
//        watch's parallel POST doesn't surface an error.
export async function POST(req: NextRequest) {
  const uid = await resolveWatchUserId(req.headers.get("authorization"));
  if (!uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    type?: string;
    kind?: string;
    id?: string;
    decision?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const type = String(body.type ?? "");
  const admin = createServiceClient();

  if (type === "confirm") {
    const id = String(body.id ?? "");
    const kind = String(body.kind ?? "");
    const business = String(body.decision ?? "") === "left";
    if (!id) {
      return NextResponse.json({ error: "missing_id" }, { status: 400 });
    }

    if (kind === "trip") {
      const res = await reclassifyTripCore(
        admin,
        uid,
        id,
        business ? "business" : "personal",
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

    // expense / income — a bank_transactions row.
    const { data: tx } = await admin
      .from("bank_transactions")
      .select("id, company_id, suggested_category_code")
      .eq("id", id)
      .maybeSingle();
    if (!tx) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const { data: membership } = await admin
      .from("company_members")
      .select("user_id")
      .eq("company_id", (tx as { company_id: string }).company_id)
      .eq("user_id", uid)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (business) {
      await admin
        .from("bank_transactions")
        .update({
          applied_category_code:
            (tx as { suggested_category_code: string | null })
              .suggested_category_code ?? null,
          ignored: false,
        })
        .eq("id", id);
    } else {
      await admin
        .from("bank_transactions")
        .update({ ignored: true, applied_category_code: null })
        .eq("id", id);
    }
    return NextResponse.json({ ok: true, did: "clarify_expense" });
  }

  // autoApply: persist the new value on profiles.mileage_schedule
  // so the next snapshot pull returns the correct toggle state
  // (otherwise the watch flips the toggle back after 60s when the
  // server's default false overrides the optimistic UI). Body:
  // { type: "autoApply", value: "on" | "off" }
  if (type === "autoApply") {
    const rawValue = (body as { value?: string }).value;
    const next = String(rawValue ?? "") === "on";
    const { data: prof } = await admin
      .from("profiles")
      .select("mileage_schedule")
      .eq("id", uid)
      .maybeSingle();
    const current =
      (prof?.mileage_schedule as Record<string, unknown> | null) ?? {
        mode: "always",
      };
    await admin
      .from("profiles")
      .update({ mileage_schedule: { ...current, autoApplyBusiness: next } })
      .eq("id", uid);
    return NextResponse.json({ ok: true, did: "auto_apply_persisted" });
  }

  // mileage / open are phone-side actions (start GPS, foreground a
  // route) — the server can't start the phone's foreground service
  // by itself. 200 so the watch's parallel POST is a harmless no-op
  // and the Data Layer delivers when the phone is up.
  if (type === "mileage" || type === "open") {
    return NextResponse.json({ ok: true, did: "noop_phone_side" });
  }

  return NextResponse.json({ error: "unknown_type" }, { status: 400 });
}
