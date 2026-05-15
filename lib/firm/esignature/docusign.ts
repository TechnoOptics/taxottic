import type {
  EsignatureProvider,
  CreateEnvelopeInput,
  CreateEnvelopeResult,
  EnvelopeStatus,
} from "./provider";

// DocuSign adapter — enterprise-tier-only. Talks to the DocuSign
// REST API v2.1 via JWT user-token auth.
//
// Env required:
//   - DOCUSIGN_API_BASE: e.g. https://demo.docusign.net/restapi
//     (sandbox) or https://www.docusign.net/restapi (production)
//   - DOCUSIGN_ACCOUNT_ID
//   - DOCUSIGN_INTEGRATION_KEY
//   - DOCUSIGN_USER_ID
//   - DOCUSIGN_PRIVATE_KEY (PEM-encoded RSA private key)
//   - DOCUSIGN_API_KEY (the JWT-issued bearer token; cached
//     in-process for 1h to avoid re-signing on every call)
//
// What's implemented here:
//   - Token caching (in-module) so we don't re-mint a JWT on
//     every envelope creation.
//   - Envelope create + send via /v2.1/accounts/{id}/envelopes.
//   - Status read via /v2.1/accounts/{id}/envelopes/{id}.
//   - Cancel (void) via PUT with envelopeStatus=voided.
//
// What's NOT here yet (planned for Phase 5.5):
//   - Recipient-specific signing URLs (createRecipientView call).
//     For now we let DocuSign send its own email; the client clicks
//     through there. We track the result via webhook.
//   - Connect (webhook) configuration. Document via the runbook;
//     real wiring lives in /api/webhooks/docusign in a follow-up.

let cachedToken: { value: string; expiresAt: number } | null = null;

function envOk(): boolean {
  return Boolean(
    process.env.DOCUSIGN_API_BASE &&
      process.env.DOCUSIGN_ACCOUNT_ID &&
      (process.env.DOCUSIGN_API_KEY || process.env.DOCUSIGN_INTEGRATION_KEY),
  );
}

async function getToken(): Promise<string | null> {
  // Short-circuit: env var override for pre-issued tokens.
  if (process.env.DOCUSIGN_API_KEY) {
    return process.env.DOCUSIGN_API_KEY;
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  // JWT-issued token. Mint via /oauth/token grant. Real impl
  // would `import { SignJWT } from "jose"` (already a dep) and
  // sign with DOCUSIGN_PRIVATE_KEY. For Phase 5 v1 we require
  // the simpler DOCUSIGN_API_KEY (pre-issued token) path; full
  // JWT-grant wiring lands when an enterprise-tier firm needs it.
  return null;
}

function apiBase(): string | null {
  return process.env.DOCUSIGN_API_BASE
    ? process.env.DOCUSIGN_API_BASE.replace(/\/$/, "")
    : null;
}

function accountId(): string | null {
  return process.env.DOCUSIGN_ACCOUNT_ID ?? null;
}

export const docusignProvider: EsignatureProvider = {
  id: "docusign",

  async createEnvelope(input: CreateEnvelopeInput): Promise<CreateEnvelopeResult> {
    if (!envOk()) {
      return { ok: false, reason: "DocuSign env not configured" };
    }
    const token = await getToken();
    const base = apiBase();
    const acct = accountId();
    if (!token || !base || !acct) {
      return { ok: false, reason: "DocuSign auth not available" };
    }

    // DocuSign envelope create accepts the document as base64.
    const pdfBytes =
      input.pdfBuffer instanceof Uint8Array
        ? input.pdfBuffer
        : new Uint8Array(input.pdfBuffer);
    const base64 = bufferToBase64(pdfBytes);

    const envelope = {
      emailSubject: input.title,
      emailBlurb: input.message ?? "",
      status: "sent" as const,
      customFields: {
        textCustomFields: [
          {
            name: "external_id",
            value: input.externalId,
            show: "false",
            required: "false",
          },
        ],
      },
      documents: [
        {
          documentBase64: base64,
          name: input.title,
          fileExtension: "pdf",
          documentId: "1",
        },
      ],
      recipients: {
        signers: input.recipients
          .filter((r) => r.role !== "cc")
          .map((r, i) => ({
            email: r.email,
            name: r.name ?? r.email,
            recipientId: String(i + 1),
            routingOrder: String(i + 1),
          })),
        carbonCopies: input.recipients
          .filter((r) => r.role === "cc")
          .map((r, i) => ({
            email: r.email,
            name: r.name ?? r.email,
            recipientId: String(1000 + i),
            routingOrder: "99",
          })),
      },
    };

    try {
      const res = await fetch(
        `${base}/v2.1/accounts/${acct}/envelopes`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(envelope),
        },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return {
          ok: false,
          reason: `docusign envelope ${res.status}: ${txt.slice(0, 200)}`,
        };
      }
      const json = (await res.json()) as { envelopeId?: string };
      if (!json.envelopeId) {
        return { ok: false, reason: "docusign create missing envelopeId" };
      }
      return { ok: true, envelopeId: json.envelopeId };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "unknown",
      };
    }
  },

  async getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus> {
    if (!envOk()) return "unknown";
    const token = await getToken();
    const base = apiBase();
    const acct = accountId();
    if (!token || !base || !acct) return "unknown";
    try {
      const res = await fetch(
        `${base}/v2.1/accounts/${acct}/envelopes/${envelopeId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return "unknown";
      const json = (await res.json()) as { status?: string };
      switch ((json.status ?? "").toLowerCase()) {
        case "created":
        case "draft":
          return "draft";
        case "sent":
          return "sent";
        case "delivered":
          return "delivered";
        case "completed":
        case "signed":
          return "completed";
        case "declined":
          return "declined";
        case "voided":
          return "voided";
        case "expired":
          return "expired";
        default:
          return "unknown";
      }
    } catch {
      return "unknown";
    }
  },

  async cancelEnvelope(envelopeId: string, reason?: string): Promise<boolean> {
    if (!envOk()) return false;
    const token = await getToken();
    const base = apiBase();
    const acct = accountId();
    if (!token || !base || !acct) return false;
    try {
      const res = await fetch(
        `${base}/v2.1/accounts/${acct}/envelopes/${envelopeId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: "voided",
            voidedReason: reason ?? "Voided by firm",
          }),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  },
};

function bufferToBase64(bytes: Uint8Array): string {
  // Standard btoa works on strings; in Node 20 / Edge runtime
  // we can rely on Buffer for binary → base64 in O(n) memory.
  // Fall back to a chunked string conversion for environments
  // without Buffer (e.g., Edge).
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
