/**
 * UNREVIEWED DRAFT. Not legal advice, not a final legal instrument.
 *
 * Revised 2026-08-01 against the code. The previous list named six
 * vendors and was missing every one of these live integrations:
 *   Resend            lib/email/transport.ts:97
 *   Google Maps       lib/maps/static-map.ts:107, geocode.ts:40,
 *                     google-maps-loader.ts:102, reverseGeocode.ts:59
 *   Apple APNs        lib/push/providers.ts:38-94
 *   Google FCM        lib/push/providers.ts:300
 *   Documenso         lib/firm/esignature/documenso.ts:10
 *   DocuSign          lib/firm/esignature/docusign.ts:12-72
 *   Zoom              lib/firm/scheduling/zoom.ts
 * Google Maps is the important omission: precise trip coordinates are
 * put in a Static Maps URL and sent to Google.
 *
 * Two claims were also corrected:
 *   - Anthropic's entry asserted an "Enterprise agreement: zero data
 *     retention for training". Nothing in this repo evidences such an
 *     agreement and no code sets a ZDR header or beta flag. Softened.
 *     OWNER/ATTORNEY: confirm what the Anthropic contract actually
 *     says and restore a precise statement, or leave it as is.
 *   - Anthropic's data scope said "messages you send to Bella +
 *     minimal account context". It also receives complete uploaded
 *     document images (lib/ocr/extract-*.ts) and bank transaction
 *     descriptions (lib/csv/bella-categorize.ts). Corrected.
 *
 * Certification claims on this page (SOC 2, ISO 27001, PCI DSS) are
 * about the VENDORS, restated from their own marketing. They are not
 * claims about Taxottic. Taxottic itself has had no third-party audit,
 * and docs/store-listing/PRIVACY_DATA_MAP.md:79-81 is explicit that we
 * must not claim one.
 */

export const metadata = {
  title: "Subprocessors - Taxottic",
  description:
    "Every vendor that processes Taxottic customer data on our behalf, what each one receives, and where it is processed.",
  alternates: { canonical: "/legal/subprocessors" },
};

type Sub = {
  name: string;
  role: string;
  data: string;
  region: string;
  certs: string;
  url: string;
};

const SUBPROCESSORS: Sub[] = [
  {
    name: "Vercel",
    role: "Hosting + CDN for the Taxottic web app.",
    data: "HTTP request metadata, IP at request time (not stored long-term).",
    region: "United States (global edge for static assets).",
    certs: "SOC 2 Type II, ISO 27001, GDPR-aligned DPA.",
    url: "https://vercel.com/legal/privacy-policy",
  },
  {
    name: "Supabase",
    role: "Postgres database, authentication, storage of user files.",
    data: "All application data (tax profiles, expenses, conversations, bank metadata).",
    region: "United States (AWS us-east-1).",
    certs: "SOC 2 Type II, HIPAA-eligible, GDPR-aligned DPA.",
    url: "https://supabase.com/privacy",
  },
  {
    name: "Plaid",
    role: "Bank connectivity, transaction sync.",
    data: "Bank account ID, transaction merchant + date + amount, institution name. Bank credentials are entered into Plaid's UI and never reach Taxottic.",
    region: "United States.",
    certs: "SOC 2 Type II, ISO 27001:2013, AICPA SOC for Service Organisations.",
    url: "https://plaid.com/legal/",
  },
  {
    name: "Anthropic",
    role: "Powers Bella (our in-app AI guide), reads the receipts, pay stubs, W-2s and prior-year tax documents you scan, and suggests categories for imported bank transactions.",
    data: "Your questions to Bella and recent conversation turns, a summary of your tax and company situation including year-to-date income and expense totals, the complete file you scan (the whole image or PDF is sent, not only the fields we ask for), and bank transaction descriptions, amounts and dates.",
    region: "United States.",
    certs:
      "SOC 2 Type II. Under our commercial terms, customer content is not used to train general models.",
    url: "https://www.anthropic.com/legal/privacy",
  },
  {
    name: "Stripe",
    role: "Subscription and credit-pack billing, and, if you connect one, Stripe as an income source.",
    data: "Email, billing address and payment details you enter in Stripe-hosted checkout. Card numbers never reach Taxottic and we store none. For a connected Stripe account, the payout and charge records we sync back.",
    region: "United States.",
    certs: "PCI DSS Level 1, SOC 1 / SOC 2 Type II, ISO 27001.",
    url: "https://stripe.com/privacy",
  },
  {
    name: "Google Maps Platform",
    role: "Draws the maps and route thumbnails on the mileage screens, turns coordinates into place names, and geocodes addresses you type.",
    data: "Precise trip coordinates. Route points are included in the map-image request, and the first and last point of a drive are sent to be resolved to a street address and a nearby business name. Addresses you type for saved places are also sent.",
    region: "United States and Google's global infrastructure.",
    certs: "ISO 27001, SOC 2/3.",
    url: "https://policies.google.com/privacy",
  },
  {
    name: "Google (sign-in and push)",
    role: "Optional sign-in via Google OAuth, optional Google Calendar connection, and delivery of Android push notifications via Firebase Cloud Messaging.",
    data: "Name, email, profile photo from the openid email profile scopes. Calendar data only if you connect a calendar. For push: your device token and the short notification text.",
    region: "United States.",
    certs: "ISO 27001, SOC 2/3, FedRAMP.",
    url: "https://policies.google.com/privacy",
  },
  {
    name: "Apple",
    role: "Delivery of push notifications to iPhones and iPads.",
    data: "Your device token and the short notification text.",
    region: "United States and Apple's global infrastructure.",
    certs: "ISO 27001, SOC 2.",
    url: "https://www.apple.com/legal/privacy/",
  },
  {
    name: "Microsoft",
    role: "Optional sign-in via Microsoft Identity Platform, and optional Outlook calendar connection for firms.",
    data: "Name, email, profile photo from the openid email profile scopes. Calendar data only if you connect a calendar.",
    region: "United States and EU (per Microsoft's regional model).",
    certs: "SOC 1/2/3, ISO 27001, FedRAMP.",
    url: "https://privacy.microsoft.com/en-us/privacystatement",
  },
  {
    name: "Resend",
    role: "Sends transactional email: sign-in links, invitations, receipts, reminders, and security notices.",
    data: "Your email address and the contents of the message we send you.",
    region: "United States.",
    certs: "SOC 2 Type II, GDPR-aligned DPA.",
    url: "https://resend.com/legal/privacy-policy",
  },
  {
    name: "Documenso",
    role: "Electronic signature for firm documents, on an instance we run.",
    data: "The document sent for signature, and the signer's name, email, and signature event record.",
    region: "United States.",
    certs: "Self-hosted by Techno Optics LLC on our own infrastructure.",
    url: "https://documenso.com/privacy",
  },
  {
    name: "DocuSign",
    role: "Alternative electronic signature provider for firms that choose it.",
    data: "The document sent for signature, and the signer's name, email, and signature event record.",
    region: "United States.",
    certs: "SOC 1/2 Type II, ISO 27001, PCI DSS.",
    url: "https://www.docusign.com/company/privacy-policy",
  },
  {
    name: "Zoom",
    role: "Optional meeting links for firms that connect Zoom to their scheduling.",
    data: "Meeting metadata for appointments a firm creates. Meeting contents are not sent to or stored by Taxottic.",
    region: "United States.",
    certs: "SOC 2 Type II, ISO 27001.",
    url: "https://www.zoom.com/en/trust/privacy/",
  },
];

export default function SubprocessorsPage() {
  return (
    <main id="main" className="min-h-screen">
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Subprocessors
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Who else processes your data.
        </h1>
        <p className="mt-2 text-xs text-ink-muted">
          Last updated: 2026-08-01
        </p>

        <p className="mt-6 text-sm text-ink-soft leading-relaxed max-w-2xl">
          To run Taxottic we rely on a short, vetted list of vendors. We
          do not engage a new subprocessor without first reviewing their
          security practices and data-protection commitments. We update
          this page when we add or change a vendor and announce material
          changes in-app at least 30 days before they take effect.
        </p>

        <p className="mt-3 text-xs text-ink-muted leading-relaxed max-w-2xl">
          The certifications listed below are the vendors&apos; own, not
          Taxottic&apos;s. Taxottic has not been through a third-party
          security audit, and we do not claim one.
        </p>

        <div className="mt-8 grid gap-3">
          {SUBPROCESSORS.map((s) => (
            <article
              key={s.name}
              className="card p-5 sm:p-6 grid gap-3"
            >
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h2 className="display text-xl text-forest-900">{s.name}</h2>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-forest-700 hover:text-forest-900 underline underline-offset-2"
                >
                  Their privacy notice ↗
                </a>
              </div>
              <Row label="Role" value={s.role} />
              <Row label="Data processed" value={s.data} />
              <Row label="Region" value={s.region} />
              <Row label="Certifications" value={s.certs} />
            </article>
          ))}
        </div>

        <p className="mt-10 text-xs text-ink-muted leading-relaxed max-w-2xl">
          Want a Data Processing Agreement (DPA)? See our standard
          template at{" "}
          <a href="/legal/dpa" className="underline hover:text-forest-900">
            /legal/dpa
          </a>
          , or write to{" "}
          <a href="mailto:privacy@taxottic.com" className="underline hover:text-forest-900">
            privacy@taxottic.com
          </a>
          .
        </p>
      </section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid sm:grid-cols-[140px_1fr] gap-1 sm:gap-3 text-sm">
      <div className="text-[11px] uppercase tracking-[0.18em] text-gold-700 sm:pt-0.5">
        {label}
      </div>
      <div className="text-ink-soft leading-relaxed">{value}</div>
    </div>
  );
}
