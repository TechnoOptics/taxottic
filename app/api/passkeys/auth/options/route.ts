import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
  RP_ID,
} from "@/lib/webauthn/config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
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
