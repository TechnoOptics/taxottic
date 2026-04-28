import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
  RP_ID,
  RP_NAME,
} from "@/lib/webauthn/config";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Don't ask the user to register the same passkey twice.
  const admin = createServiceClient();
  const { data: existing } = await admin
    .from("passkeys")
    .select("credential_id, transports")
    .eq("user_id", user.id);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user.email ?? user.id,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? []) as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(CHALLENGE_COOKIE, options.challenge, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: CHALLENGE_TTL_SECONDS,
    path: "/",
  });

  return NextResponse.json(options);
}
