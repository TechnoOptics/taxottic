import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  CHALLENGE_COOKIE,
  EXPECTED_ORIGIN,
  RP_ID,
} from "@/lib/webauthn/config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const expectedChallenge = cookieStore.get(CHALLENGE_COOKIE)?.value;
  if (!expectedChallenge) {
    return NextResponse.json({ error: "challenge expired" }, { status: 400 });
  }

  const body = await req.json();
  const friendlyName: string | undefined = body.friendly_name;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });
  } catch (err) {
    cookieStore.delete(CHALLENGE_COOKIE);
    const message = err instanceof Error ? err.message : "verification failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    cookieStore.delete(CHALLENGE_COOKIE);
    return NextResponse.json({ error: "verification failed" }, { status: 400 });
  }

  const info = verification.registrationInfo;
  const credential = info.credential;

  const admin = createServiceClient();
  const { error } = await admin.from("passkeys").insert({
    user_id: user.id,
    email: user.email ?? "",
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    device_type: info.credentialDeviceType,
    backed_up: info.credentialBackedUp,
    friendly_name: friendlyName ?? "Passkey",
  });

  cookieStore.delete(CHALLENGE_COOKIE);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
