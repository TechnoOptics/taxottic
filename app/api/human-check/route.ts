import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  issueChallenge,
  verifySolve,
  type Challenge,
  type SolveMetrics,
} from "@/lib/security/human-check";
import { checkRateLimit, clientKey } from "@/lib/security/rate-limit";

// Our own human-verification gate for the browser sign-in form (item 18).
// GET issues a signed challenge; POST redeems it into a signed pass token
// after the client proves a genuine human interaction. Node runtime because
// the signing uses node:crypto HMAC. See lib/security/human-check.ts.
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ip = clientKey(req);
  // A human needs one challenge per sign-in attempt; a bot fishing for tokens
  // gets throttled. Generous enough for retries and shared NATs.
  if (!checkRateLimit(`human-check-issue:${ip}`, { capacity: 30, refillPerMinute: 30 })) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const challenge = issueChallenge(randomUUID(), Date.now());
  return NextResponse.json(challenge, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  const ip = clientKey(req);
  if (!checkRateLimit(`human-check-verify:${ip}`, { capacity: 20, refillPerMinute: 20 })) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const challenge: Challenge = {
    nonce: String(b.nonce ?? ""),
    exp: Number(b.exp ?? 0),
    sig: String(b.sig ?? ""),
  };
  const metrics: SolveMetrics = {
    elapsedMs: Number(b.elapsedMs ?? 0),
    moves: Number(b.moves ?? 0),
    trusted: b.trusted === true,
  };
  if (!challenge.nonce || !challenge.sig || !Number.isFinite(challenge.exp)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const result = verifySolve(challenge, metrics, Date.now());
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 422 });
  }
  return NextResponse.json(result.value, {
    headers: { "Cache-Control": "no-store" },
  });
}
