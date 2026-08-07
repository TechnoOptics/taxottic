import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { reclassifyTripCore } from "@/lib/mileage/reclassify";
import { resolveWatchUserId } from "@/lib/watch/device-auth";
import {
  clarifyBankTransactionCore,
  clarifyStatus,
} from "@/lib/watch/clarify-tx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/watch/confirm  { id, kind: "trip"|"expense"|"income", decision: "left"|"right" }
//
// The watch swipe deck. `left` = Business, `right` = Personal. Auth is
// session (the watch action is untrusted) → re-authorise the target
// row → mutate. Trips reuse the same reclassifyTripCore the in-app
// button + notification action use. Bank expense/income clarification
// mirrors the EXACT writes of import/actions.ts setTxCategory /
// ignoreTx (Business → keep with its suggested category; Personal →
// ignore), scoped to a company the user belongs to.
export async function POST(req: NextRequest) {
  // Dual auth: phone session OR the watch's bearer device token
  // (QR-pairing). The watch action is still untrusted, every target
  // row is re-authorised below against the resolved account.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const uid =
    user?.id ??
    (await resolveWatchUserId(req.headers.get("authorization")));
  if (!uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { id?: string; kind?: string; decision?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  const kind = String(body.kind ?? "");
  const business = String(body.decision ?? "") === "left";
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  const admin = createServiceClient();

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

  // expense / income, a bank_transactions row. Authorisation (manager,
  // or the member who uploaded the import) and the write both live in
  // the shared core, so this route and /api/watch/action cannot drift.
  const res = await clarifyBankTransactionCore(admin, uid, id, business);
  if (!res.ok) {
    return NextResponse.json(
      { error: res.reason },
      { status: clarifyStatus(res.reason) },
    );
  }
  return NextResponse.json({ ok: true, did: "clarify_expense" });
}
