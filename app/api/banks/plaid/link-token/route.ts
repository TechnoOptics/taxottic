import { NextRequest, NextResponse } from "next/server";
import { Products, CountryCode } from "plaid";
import { createClient } from "@/lib/supabase/server";
import { getPlaidClient } from "@/lib/plaid/client";

export const runtime = "nodejs";

/**
 * Mint a one-shot link_token for Plaid Link to open with. The token
 * pre-binds the auth context to a specific Taxottic user so we know
 * who owns the resulting access_token in /exchange.
 *
 * Body: { companyId: string }   - the company the connection will
 * belong to. We persist that on the redirect_uri state because
 * Plaid Link doesn't pass arbitrary metadata back through OAuth.
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
  const companyId =
    typeof body?.companyId === "string" ? body.companyId : null;
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  // Verify the user has access to this company before minting a token
  // tied to it. RLS on companies covers the read.
  const { data: company } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 });
  }

  // OAuth-flow institutions (Chase, Capital One, etc.) require a
  // pre-registered redirect_uri. Set this in the Plaid dashboard:
  //   API tab -> Allowed redirect URIs:
  //   https://taxottic.com/api/banks/plaid/oauth-return
  const redirectUri =
    process.env.PLAID_REDIRECT_URI ||
    (process.env.NEXT_PUBLIC_SITE_URL
      ? `${process.env.NEXT_PUBLIC_SITE_URL}/api/banks/plaid/oauth-return`
      : undefined);

  // Cap historical pull to year-to-date. Taxottic forecasts the
  // current tax year only - last year's transactions don't move
  // this year's forecast and are already in the user's filed
  // return. days_requested also bounds what /transactions/sync
  // returns on the initial cursor, so this is the single lever
  // for the "first sync = YTD" requirement. Floor at 1 to keep
  // Plaid happy on a Jan-1 sign-up.
  const now = new Date();
  const startOfYearUtc = Date.UTC(now.getUTCFullYear(), 0, 1);
  const daysSinceJan1 = Math.max(
    1,
    Math.floor((now.getTime() - startOfYearUtc) / 86_400_000),
  );

  try {
    const { data } = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "Taxottic",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      redirect_uri: redirectUri,
      webhook: process.env.PLAID_WEBHOOK_URL || undefined,
      transactions: { days_requested: daysSinceJan1 },
    });
    return NextResponse.json({
      link_token: data.link_token,
      expiration: data.expiration,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "link_token_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
