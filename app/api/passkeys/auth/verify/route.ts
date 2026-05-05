import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  CHALLENGE_COOKIE,
  EXPECTED_ORIGIN,
  RP_ID,
} from "@/lib/webauthn/config";
import { checkRateLimit, clientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/**
 * Verifies a WebAuthn assertion and, on success, mints a Supabase magic link
 * that the client can navigate to in order to establish the session. The link
 * does the standard /auth/callback exchange, so cookies land normally.
 *
 * Rate-limited per source IP: 10 attempts per minute. WebAuthn assertions are
 * cryptographically expensive to forge, but a flood is still a denial-of-service
 * vector against the SimpleWebAuthn verifier and the Supabase magic-link mint.
 */
export async function POST(req: NextRequest) {
  if (!checkRateLimit(`passkey-verify:${clientKey(req)}`, { capacity: 10, refillPerMinute: 10 })) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const cookieStore = await cookies();
  const cookieRaw = cookieStore.get(CHALLENGE_COOKIE)?.value;
  if (!cookieRaw) {
    return NextResponse.json({ error: "challenge expired" }, { status: 400 });
  }

  let challenge: string;
  try {
    const parsed = JSON.parse(cookieRaw);
    challenge = parsed.challenge;
  } catch {
    return NextResponse.json({ error: "challenge invalid" }, { status: 400 });
  }

  const body = await req.json();
  const credentialId: string | undefined = body?.id;
  if (!credentialId) {
    return NextResponse.json({ error: "missing credential id" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: pk } = await admin
    .from("passkeys")
    .select("user_id, email, credential_id, public_key, counter, transports")
    .eq("credential_id", credentialId)
    .maybeSingle();
  if (!pk) {
    return NextResponse.json({ error: "passkey not found" }, { status: 404 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: pk.credential_id,
        publicKey: new Uint8Array(pk.public_key),
        counter: Number(pk.counter ?? 0),
        transports: (pk.transports ?? []) as AuthenticatorTransport[],
      },
      requireUserVerification: false,
    });
  } catch (err) {
    cookieStore.delete(CHALLENGE_COOKIE);
    const message = err instanceof Error ? err.message : "verification failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!verification.verified) {
    cookieStore.delete(CHALLENGE_COOKIE);
    return NextResponse.json({ error: "not verified" }, { status: 400 });
  }

  // Bump counter + last_used.
  await admin
    .from("passkeys")
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("credential_id", credentialId);

  // Mint a magic-link the client navigates to. Supabase handles the session
  // creation when the link is followed.
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: pk.email,
    options: {
      redirectTo: `${siteUrl}/auth/callback`,
    },
  });
  cookieStore.delete(CHALLENGE_COOKIE);
  if (linkErr || !linkData?.properties?.action_link) {
    return NextResponse.json(
      { error: linkErr?.message ?? "could not create session" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    redirect_url: linkData.properties.action_link,
  });
}
