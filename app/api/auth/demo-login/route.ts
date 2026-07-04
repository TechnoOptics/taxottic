import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// App Store / Play *review* sign-in for our passwordless, login-gated app.
//
// Taxottic's email auth is magic-link / email-OTP only: the code is
// delivered to the user's inbox, which a store reviewer cannot read. This
// route is the one sanctioned bypass, it signs in a SINGLE, hardwired demo
// account when the exact configured code is presented, so a reviewer can
// type a fixed code on the normal login screen (see app/login/page.tsx) and
// land on a seeded demo. It is NOT a generic password login:
//
//   * It is OFF unless BOTH env vars are set (so it never exists in a normal
//     deploy unless we deliberately turn it on for a review window).
//   * It only ever mints a session for REVIEW_DEMO_EMAIL, never an
//     arbitrary account, so the blast radius is one throwaway demo with
//     fake data, even if the code leaked.
//   * Remove REVIEW_DEMO_CODE (or REVIEW_DEMO_EMAIL) from the environment to
//     disable it the moment review is done.
//
// Mechanism: the service-role client mints a magic-link token_hash for the
// demo account, then a cookie-bound anon client exchanges it via verifyOtp,
// which writes the session cookies onto the response. The browser then just
// navigates and the session is already live, no tokens touch client JS.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const demoEmail = process.env.REVIEW_DEMO_EMAIL?.trim().toLowerCase();
  // .trim() both: env values added via some CLIs/shell pipes pick up a
  // trailing newline, which would otherwise make the strict compare below
  // fail even when the configured code looks right.
  const demoCode = process.env.REVIEW_DEMO_CODE?.trim();
  // Feature disabled unless explicitly configured.
  if (!demoEmail || !demoCode) {
    return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  }

  let body: { email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const code = (body.code ?? "").trim();
  // Only the single configured demo account, only with the exact configured
  // code. Anything else 422s so the client falls through to normal OTP
  // verification (a real user who happens to type a wrong code here just
  // gets the usual "invalid code" from Supabase).
  if (email !== demoEmail || code !== demoCode) {
    return NextResponse.json({ error: "not_demo_login" }, { status: 422 });
  }

  const admin = createServiceClient();
  // Idempotent: create the demo user if it doesn't exist yet (email already
  // confirmed so there's no inbox step), ignore "already registered".
  await admin.auth.admin
    .createUser({ email: demoEmail, email_confirm: true })
    .catch(() => {});

  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({ type: "magiclink", email: demoEmail });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    return NextResponse.json({ error: "link_failed" }, { status: 500 });
  }

  // Cookie-bound anon client: verifyOtp persists the session into the
  // response cookies (same store the browser client reads from).
  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: tokenHash,
  });
  if (verifyErr) {
    return NextResponse.json({ error: "verify_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
