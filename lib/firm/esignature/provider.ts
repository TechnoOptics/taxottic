// E-signature provider abstraction. The application code only ever
// reaches for `getEsigProvider(firmTier)`; the concrete adapter
// (Documenso self-host / DocuSign) implements the same interface.
//
// Why an abstraction:
//   - Firms on starter/growth/firm tiers get Documenso (zero
//     per-signature fees, our infrastructure).
//   - Firms on the enterprise tier get DocuSign as an option
//     because their clients expect to see the DocuSign envelope
//     branding. We mark up the per-envelope cost.
//
// The interface is intentionally narrow:
//   - createEnvelope: takes a PDF (or HTML to convert), recipient
//     list, returns an envelope ID + a signing URL the recipient
//     can open.
//   - getEnvelopeStatus: polled by the document detail page when
//     the webhook hasn't fired yet (offline workers, etc.).
//   - cancelEnvelope: lets the firm pull a draft envelope back.
//
// Webhooks come in at /api/webhooks/documenso (and a future
// /api/webhooks/docusign) and update firm_documents rows in
// place, see app/api/webhooks/documenso/route.ts.

export type EnvelopeRecipient = {
  email: string;
  name?: string;
  role?: "signer" | "cc";
};

export type CreateEnvelopeInput = {
  /** Unique identifier from our side; the provider stores it so
   *  the webhook can correlate back to firm_documents.id without
   *  trusting their envelope_id alone. */
  externalId: string;
  /** Display name for the envelope (shows in recipient's inbox). */
  title: string;
  /** Optional message shown above the document. */
  message?: string;
  /** PDF bytes. Required. Generate via lib/firm/documents/generate.ts. */
  pdfBuffer: ArrayBuffer | Uint8Array;
  recipients: EnvelopeRecipient[];
  /** Optional metadata threaded through the provider; surfaces in
   *  the webhook payload for round-tripping context. */
  metadata?: Record<string, string>;
};

export type CreateEnvelopeResult = {
  ok: boolean;
  envelopeId?: string;
  /** Recipient-specific signing URLs keyed by email. */
  signingUrls?: Record<string, string>;
  /** Provider-side error message when ok=false. */
  reason?: string;
};

export type EnvelopeStatus =
  | "draft"
  | "sent"
  | "delivered"
  | "completed"
  | "declined"
  | "voided"
  | "expired"
  | "unknown";

export interface EsignatureProvider {
  readonly id: "documenso" | "docusign";
  createEnvelope(input: CreateEnvelopeInput): Promise<CreateEnvelopeResult>;
  getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus>;
  cancelEnvelope(envelopeId: string, reason?: string): Promise<boolean>;
}

/**
 * Picks the right provider for a firm.
 *
 *   - enterprise tier + DOCUSIGN_API_KEY set → DocuSign
 *   - everyone else → Documenso (always our default)
 *
 * Returns null when neither provider is configured (e.g. a fresh
 * dev environment); callers degrade to "no e-signature, manual
 * download" mode.
 */
export type FirmTier = "starter" | "growth" | "firm" | "enterprise";

export async function getEsigProvider(
  tier: FirmTier,
): Promise<EsignatureProvider | null> {
  if (tier === "enterprise" && process.env.DOCUSIGN_API_KEY) {
    const { docusignProvider } = await import("./docusign");
    return docusignProvider;
  }
  if (process.env.DOCUMENSO_API_KEY) {
    const { documensoProvider } = await import("./documenso");
    return documensoProvider;
  }
  return null;
}
