import type {
  EsignatureProvider,
  CreateEnvelopeInput,
  CreateEnvelopeResult,
  EnvelopeStatus,
} from "./provider";

// Documenso adapter, talks to a self-hosted Documenso instance via
// the v1 REST API. Two env vars:
//   - DOCUMENSO_API_URL: e.g. https://documenso.taxottic.com/api/v1
//   - DOCUMENSO_API_KEY: bearer token from the admin dashboard
//
// We don't carry the documenso SDK because the public Documenso JS
// client (`@documenso/sdk-typescript`) pulls in tRPC + Zod + a small
// React bundle we don't need on the server. A direct fetch keeps
// the dependency surface tight and gives us full control over
// retries + timeouts.

function apiBase(): string | null {
  const url = process.env.DOCUMENSO_API_URL;
  if (!url) return null;
  return url.replace(/\/$/, "");
}

function authHeader(): Record<string, string> | null {
  const key = process.env.DOCUMENSO_API_KEY;
  if (!key) return null;
  return { Authorization: `Bearer ${key}` };
}

async function uploadPdf(
  pdfBuffer: ArrayBuffer | Uint8Array,
  title: string,
): Promise<{ documentId: string } | { error: string }> {
  const base = apiBase();
  const auth = authHeader();
  if (!base || !auth) return { error: "Documenso env not configured" };

  // Documenso accepts a multipart upload at /documents. Wrap the
  // buffer in a Blob so the FormData built-in works in Node 20+ and
  // Edge runtimes equally. The TS-DOM types reject `Uint8Array`
  // directly when the backing store could be SharedArrayBuffer; the
  // slice() below normalizes to a plain ArrayBuffer.
  const ab =
    pdfBuffer instanceof Uint8Array
      ? pdfBuffer.buffer.slice(
          pdfBuffer.byteOffset,
          pdfBuffer.byteOffset + pdfBuffer.byteLength,
        )
      : pdfBuffer;
  const blob = new Blob([ab as ArrayBuffer], { type: "application/pdf" });
  const form = new FormData();
  form.append("file", blob, `${sanitizeTitle(title)}.pdf`);

  try {
    const res = await fetch(`${base}/documents`, {
      method: "POST",
      headers: auth,
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { error: `documenso upload ${res.status}: ${txt.slice(0, 200)}` };
    }
    const json = (await res.json()) as { id?: string };
    if (!json.id) return { error: "documenso upload missing id" };
    return { documentId: json.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "unknown" };
  }
}

async function attachRecipients(
  documentId: string,
  recipients: CreateEnvelopeInput["recipients"],
): Promise<{ ok: boolean; signingUrls?: Record<string, string>; error?: string }> {
  const base = apiBase();
  const auth = authHeader();
  if (!base || !auth) return { ok: false, error: "Documenso env not configured" };

  // Documenso models recipients as /documents/{id}/recipients with
  // a body of { recipients: [...] }. Signing URLs are returned per
  // recipient on creation.
  try {
    const res = await fetch(`${base}/documents/${documentId}/recipients`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        recipients: recipients.map((r) => ({
          email: r.email,
          name: r.name ?? r.email,
          role: r.role === "cc" ? "CC" : "SIGNER",
        })),
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return {
        ok: false,
        error: `documenso recipients ${res.status}: ${txt.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as {
      recipients?: { email: string; signing_url?: string }[];
    };
    const urls: Record<string, string> = {};
    for (const r of json.recipients ?? []) {
      if (r.email && r.signing_url) urls[r.email] = r.signing_url;
    }
    return { ok: true, signingUrls: urls };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

async function sendEnvelope(documentId: string): Promise<boolean> {
  const base = apiBase();
  const auth = authHeader();
  if (!base || !auth) return false;
  try {
    const res = await fetch(`${base}/documents/${documentId}/send`, {
      method: "POST",
      headers: auth,
    });
    return res.ok;
  } catch {
    return false;
  }
}

function sanitizeTitle(title: string): string {
  return title.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 64) || "document";
}

export const documensoProvider: EsignatureProvider = {
  id: "documenso",

  async createEnvelope(input: CreateEnvelopeInput): Promise<CreateEnvelopeResult> {
    const uploaded = await uploadPdf(input.pdfBuffer, input.title);
    if ("error" in uploaded) {
      return { ok: false, reason: uploaded.error };
    }
    const attached = await attachRecipients(uploaded.documentId, input.recipients);
    if (!attached.ok) {
      return { ok: false, reason: attached.error, envelopeId: uploaded.documentId };
    }
    const sent = await sendEnvelope(uploaded.documentId);
    if (!sent) {
      return {
        ok: false,
        reason: "documenso send failed",
        envelopeId: uploaded.documentId,
        signingUrls: attached.signingUrls,
      };
    }
    return {
      ok: true,
      envelopeId: uploaded.documentId,
      signingUrls: attached.signingUrls,
    };
  },

  async getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus> {
    const base = apiBase();
    const auth = authHeader();
    if (!base || !auth) return "unknown";
    try {
      const res = await fetch(`${base}/documents/${envelopeId}`, {
        headers: auth,
      });
      if (!res.ok) return "unknown";
      const json = (await res.json()) as { status?: string };
      // Documenso statuses → our common set.
      switch ((json.status ?? "").toUpperCase()) {
        case "DRAFT":
          return "draft";
        case "PENDING":
        case "SENT":
          return "sent";
        case "DELIVERED":
          return "delivered";
        case "COMPLETED":
        case "SIGNED":
          return "completed";
        case "DECLINED":
          return "declined";
        case "VOIDED":
        case "CANCELLED":
          return "voided";
        case "EXPIRED":
          return "expired";
        default:
          return "unknown";
      }
    } catch {
      return "unknown";
    }
  },

  async cancelEnvelope(envelopeId: string): Promise<boolean> {
    const base = apiBase();
    const auth = authHeader();
    if (!base || !auth) return false;
    try {
      const res = await fetch(`${base}/documents/${envelopeId}`, {
        method: "DELETE",
        headers: auth,
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};
