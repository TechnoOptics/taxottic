import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { logFirmActivity } from "@/lib/firm/activity";

export const runtime = "nodejs";

/**
 * Documenso webhook receiver.
 *
 * Documenso fires events like `document.signed`, `document.completed`,
 * `document.declined`, `document.opened`. We care about the lifecycle
 * transitions:
 *   - signed / completed → firm_documents.status = 'signed' (+ activity log)
 *   - declined → status = 'error' (firm sees + can re-send)
 *   - voided → status = 'archived'
 *
 * Auth: the webhook payload is signed with the Documenso webhook
 * secret. We verify the signature header against the body to make
 * sure a third party can't spoof "your client signed it!". See
 * https://documenso.com/docs/api/webhooks for the exact signature
 * algorithm.
 */

const SECRET_ENV = "DOCUMENSO_WEBHOOK_SECRET";

type DocumensoEvent = {
  event: string;
  payload?: {
    id?: string;
    status?: string;
    completedAt?: string;
    declinedAt?: string;
    voidedAt?: string;
    customFields?: Record<string, string>;
  };
};

async function verifySignature(req: NextRequest, body: string): Promise<boolean> {
  const secret = process.env[SECRET_ENV];
  if (!secret) {
    // No secret configured → reject. We never want to accept
    // unauthenticated webhook traffic in production. In dev, set
    // the env var to a fixed value to test locally.
    return false;
  }
  const headerSig = req.headers.get("x-documenso-signature");
  if (!headerSig) return false;
  // HMAC-SHA256 of the raw body, base64 or hex (Documenso uses hex).
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(body),
  );
  const computed = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time compare.
  if (headerSig.length !== computed.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= headerSig.charCodeAt(i) ^ computed.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ok = await verifySignature(req, raw);
  if (!ok) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: DocumensoEvent;
  try {
    payload = JSON.parse(raw) as DocumensoEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const envelopeId = payload.payload?.id;
  if (!envelopeId) {
    return NextResponse.json({ ok: true, ignored: "no envelope id" });
  }

  const admin = createServiceClient();
  const { data: doc } = await admin
    .from("firm_documents")
    .select(
      "id, firm_id, engagement_id, company_id, status, kind, filename",
    )
    .eq("provider", "documenso")
    .eq("provider_envelope_id", envelopeId)
    .maybeSingle();
  if (!doc) {
    return NextResponse.json({ ok: true, ignored: "no matching doc" });
  }

  let newStatus: string | null = null;
  let activityKind: string | null = null;
  let summary = "";
  switch (payload.event) {
    case "document.signed":
    case "document.completed":
      newStatus = "signed";
      activityKind = "firm.document_signed";
      summary = `Document signed: ${doc.filename}.`;
      break;
    case "document.declined":
      newStatus = "error";
      activityKind = "firm.document_signed";
      summary = `Document declined: ${doc.filename}.`;
      break;
    case "document.voided":
    case "document.cancelled":
      newStatus = "archived";
      activityKind = "firm.note_added";
      summary = `Document voided: ${doc.filename}.`;
      break;
    case "document.sent":
    case "document.opened":
      // Status transition for "sent" already happened when we
      // created the envelope; the open event is informational.
      return NextResponse.json({ ok: true, ignored: payload.event });
    default:
      return NextResponse.json({ ok: true, ignored: payload.event });
  }

  if (newStatus) {
    const patch: Record<string, unknown> = { status: newStatus };
    if (newStatus === "signed") patch.signed_at = new Date().toISOString();
    await admin.from("firm_documents").update(patch).eq("id", doc.id);
  }
  if (activityKind) {
    await logFirmActivity({
      client: admin,
      firmId: doc.firm_id,
      companyId: doc.company_id,
      engagementId: doc.engagement_id,
      kind: activityKind as Parameters<typeof logFirmActivity>[0]["kind"],
      summary,
      payload: { document_id: doc.id, envelope_id: envelopeId },
      actorSide: "system",
    });
  }
  return NextResponse.json({ ok: true });
}
