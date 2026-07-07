import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireFeatureGate } from "@/lib/plans/gate";
import { syncPlaidConnection } from "@/lib/plaid/sync";
import { syncStripeConnection } from "@/lib/stripe-connect/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * "Sync now" for a whole company, refreshes every connected bank / Stripe
 * account in one click, so the user can pull fresh data from where they
 * actually read their numbers (the forecast) instead of visiting the banks
 * page and syncing each connection by hand.
 *
 * Body: { publicId: string }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  // Same billable-call gate as the per-connection sync.
  const gateFail = await requireFeatureGate(supabase, user.id, "bankConnect");
  if (gateFail) return gateFail;

  const body = await req.json().catch(() => ({}));
  const publicId = body?.publicId as string | undefined;
  if (!publicId) {
    return NextResponse.json({ error: "publicId required" }, { status: 400 });
  }

  // Resolve the company through the USER client so RLS confirms access.
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("public_id", publicId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!company) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: conns } = await supabase
    .from("bank_connections")
    .select("id, provider")
    .eq("company_id", company.id)
    .is("deleted_at", null);

  if (!conns || conns.length === 0) {
    return NextResponse.json({ ok: true, connections: 0, added: 0 });
  }

  const admin = createServiceClient();
  let added = 0;
  let failed = 0;
  for (const conn of conns) {
    try {
      if (conn.provider === "stripe") {
        const r = await syncStripeConnection(admin, conn.id, { force: true });
        added += r.added ?? 0;
      } else {
        const r = await syncPlaidConnection(admin, conn.id, { force: true });
        added += r.added ?? 0;
      }
    } catch (err) {
      failed += 1;
      await admin
        .from("bank_connections")
        .update({
          status: "error",
          last_error: err instanceof Error ? err.message : String(err),
        })
        .eq("id", conn.id);
    }
  }

  return NextResponse.json({
    ok: failed === 0,
    connections: conns.length,
    added,
    failed,
  });
}
