import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { reclassifyTripCore } from "@/lib/mileage/reclassify";
import { resolveWatchUserId } from "@/lib/watch/device-auth";

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
  // (QR-pairing). The watch action is still untrusted — every target
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

  // expense / income — a bank_transactions row.
  const { data: tx } = await admin
    .from("bank_transactions")
    .select("id, company_id, suggested_category_code")
    .eq("id", id)
    .maybeSingle();
  if (!tx) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Authorise: the tx's company must be one the user is a member of
  // (same check as import/actions.ts userBelongsToCompany).
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
    // Mirrors setTxCategory: keep it, staged with its suggested
    // deduction category (null is allowed — leaves it for the
    // in-app apply step, but un-ignored).
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
    // Mirrors ignoreTx: personal → off the books.
    await admin
      .from("bank_transactions")
      .update({ ignored: true, applied_category_code: null })
      .eq("id", id);
  }
  return NextResponse.json({ ok: true, did: "clarify_expense" });
}
