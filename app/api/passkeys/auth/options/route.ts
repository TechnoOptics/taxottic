import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
  RP_ID,
} from "@/lib/webauthn/config";
import { checkRateLimit, clientKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // ACCOUNT-EXISTENCE ORACLE. This endpoint is unauthenticated, and its
  // response shape answers "does this email have a Taxottic passkey?":
  // allowCredentials is populated for a registered user and omitted
  // otherwise. Without a limit that is a free, unthrottled way to test an
  // arbitrary email list against the user base.
  //
  // The sibling verify route has carried this guard since it shipped
  // (app/api/passkeys/auth/verify/route.ts:24); only this one was missed,
  // which is why the oracle survived the 2026-08-02 revoke that closed the
  // underlying RPC to anon. Revoking the RPC stopped direct PostgREST
  // calls; it did nothing about the route that legitimately proxies it.
  if (
    !checkRateLimit(`passkey-options:${clientKey(req)}`, {
      capacity: 10,
      refillPerMinute: 10,
    })
  ) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const email: string | undefined = body?.email
    ? String(body.email).trim().toLowerCase()
    : undefined;

  let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] = [];
  if (email) {
    const admin = createServiceClient();
    const { data } = await admin.rpc("passkey_lookup_by_email", {
      p_email: email,
    });
    allowCredentials =
      (data as { credential_id: string; transports: string[] | null }[] | null)?.map(
        (c) => ({
          id: c.credential_id,
          transports: (c.transports ?? []) as AuthenticatorTransport[],
        }),
      ) ?? [];
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    allowCredentials: allowCredentials.length ? allowCredentials : undefined,
  });

  const cookieStore = await cookies();
  cookieStore.set(
    CHALLENGE_COOKIE,
    JSON.stringify({ challenge: options.challenge, email: email ?? null }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: CHALLENGE_TTL_SECONDS,
      path: "/",
    },
  );

  return NextResponse.json(options);
}
