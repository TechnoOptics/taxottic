import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { requireFeatureGate } from "@/lib/plans/gate";
import {
  buildAuthorizeUrl,
  isStripeConnectConfigured,
} from "@/lib/stripe-connect/client";

export const runtime = "nodejs";

/**
 * Step 1 of the Stripe Connect OAuth: mint an authorize URL + CSRF
 * state, return both to the client. The client opens window.location
 * = url so the user lands on Stripe-hosted consent. The state is
 * also persisted as a short-lived HttpOnly cookie that the callback
 * (oauth-return) must match before exchanging the code, otherwise an
 * attacker could replay a code captured elsewhere.
 *
 * Body: { companyId: string }
 *
 * We encode the companyId into the state itself (as JSON in the
 * cookie payload, not in the state token sent to Stripe — that
 * stays opaque). Stripe sends `state` back verbatim on return; we
 * use it solely as a CSRF nonce.
 */
export async function POST(req: NextRequest) {
  if (!isStripeConnectConfigured()) {
    return NextResponse.json(
      {
        error:
          "Stripe Connect not configured. Set STRIPE_CONNECT_CLIENT_ID on the server.",
      },
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

  // Same gate as Plaid - bank-connect is paid-only.
  const gateFail = await requireFeatureGate(supabase, user.id, "bankConnect");
  if (gateFail) return gateFail;

  const body = await req.json().catch(() => ({}));
  const companyId =
    typeof body?.companyId === "string" ? body.companyId : null;
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }
  // Verify the user has access to this company (RLS on companies
  // would block the read otherwise). Mirrors the Plaid link-token
  // route.
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 });
  }

  const state = randomBytes(24).toString("hex");
  const url = buildAuthorizeUrl(state);

  // Persist the state + companyId in an HttpOnly cookie so the
  // oauth-return handler can verify it without trusting the query
  // string. 10-minute TTL is plenty for the OAuth round-trip.
  const response = NextResponse.json({ url });
  response.cookies.set("stripe_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 10,
  });
  response.cookies.set("stripe_oauth_company", companyId, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
