import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Plaid Link OAuth-flow institutions (Chase, Capital One, etc.) send
 * the user to redirect_uri after they authenticate at the bank. We
 * just need to bounce them back into Plaid Link, which the client
 * picks up via the receivedRedirectUri parameter.
 *
 * The `companyId` round-trips through the link_token state via Plaid
 * Link's own oauthStateId mechanism; we don't have to persist it
 * here. The browser-side ConnectButton restarts Plaid Link with the
 * full URL on this page and Plaid finishes the flow.
 */
export async function GET(req: NextRequest) {
  // Just render a tiny page that re-opens Plaid Link with the full
  // current URL. The companyId is preserved via the original state
  // stored in localStorage by the client component.
  const fullUrl = req.url;
  const html = `<!DOCTYPE html>
<html>
  <head>
    <title>Returning to Taxottic...</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: ui-sans-serif, system-ui; padding: 4rem; text-align: center; color: #214031; }
    </style>
  </head>
  <body>
    <p>Bringing you back to your bank connection...</p>
    <script>
      try {
        sessionStorage.setItem("plaid_oauth_return_url", ${JSON.stringify(fullUrl)});
        const companyId = localStorage.getItem("plaid_oauth_company_id") || "";
        const dest = companyId ? "/c/" + encodeURIComponent(companyId) + "/banks?plaid_oauth=1" : "/dashboard";
        window.location.replace(dest);
      } catch (e) {
        window.location.replace("/dashboard");
      }
    </script>
  </body>
</html>`;
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
