import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getPlaidClient } from "@/lib/plaid/client";
import { syncPlaidConnection } from "@/lib/plaid/sync";

export const runtime = "nodejs";

/**
 * Exchange a Plaid public_token (handed to the client by Plaid Link
 * on success) for a long-lived access_token, persist it, and run an
 * initial sync so the user sees transactions immediately.
 *
 * Body: {
 *   publicToken: string,
 *   companyId: string,
 *   institutionId?: string,
 *   institutionName?: string,
 *   institutionLogoUrl?: string
 * }
 */
export async function POST(req: NextRequest) {
  const plaid = getPlaidClient();
  if (!plaid) {
    return NextResponse.json(
      { error: "plaid_not_configured" },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const publicToken = body?.publicToken as string | undefined;
  const companyId = body?.companyId as string | undefined;
  if (!publicToken || !companyId) {
    return NextResponse.json(
      { error: "publicToken + companyId required" },
      { status: 400 },
    );
  }

  // Confirm the user can write to this company.
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 });
  }

  // Service-role from here: writes to bank_connections and
  // bank_connection_secrets bypass RLS intentionally because the
  // access_token must never be readable by the user.
  const admin = createServiceClient();

  let accessToken: string;
  let itemId: string;
  try {
    const { data } = await plaid.itemPublicTokenExchange({
      public_token: publicToken,
    });
    accessToken = data.access_token;
    itemId = data.item_id;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "exchange_failed" },
      { status: 502 },
    );
  }

  // Insert (or upsert) the bank_connection row. Reusing existing
  // external_item_id is rare but possible (re-linking a revoked
  // connection); upsert keeps things idempotent.
  const { data: connection, error: connErr } = await admin
    .from("bank_connections")
    .upsert(
      {
        company_id: companyId,
        created_by: user.id,
        provider: "plaid",
        external_item_id: itemId,
        institution_id: body?.institutionId ?? null,
        institution_name: body?.institutionName ?? null,
        institution_logo_url: body?.institutionLogoUrl ?? null,
        status: "pending",
      },
      { onConflict: "external_item_id" },
    )
    .select("id")
    .single();
  if (connErr || !connection) {
    return NextResponse.json(
      { error: connErr?.message ?? "connection_insert_failed" },
      { status: 500 },
    );
  }

  await admin
    .from("bank_connection_secrets")
    .upsert(
      {
        connection_id: connection.id,
        access_token: accessToken,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "connection_id" },
    );

  // Initial sync. If it fails, leave the connection in 'pending' so
  // the UI can show a reconnect prompt instead of pretending it's
  // healthy.
  try {
    const result = await syncPlaidConnection(admin, connection.id);
    return NextResponse.json({
      ok: true,
      connectionId: connection.id,
      ...result,
    });
  } catch (err) {
    await admin
      .from("bank_connections")
      .update({
        status: "error",
        last_error: err instanceof Error ? err.message : String(err),
      })
      .eq("id", connection.id);
    return NextResponse.json(
      {
        ok: false,
        connectionId: connection.id,
        error: err instanceof Error ? err.message : "initial_sync_failed",
      },
      { status: 500 },
    );
  }
}
