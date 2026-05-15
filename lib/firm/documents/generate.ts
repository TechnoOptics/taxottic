// Document generation engine.
//
// Phase 5 v1 ships the engagement letter generator (firm ↔ client
// contract). Schedule C / K-1 / 1099 generators live in the same
// shape but their templates need per-form, per-tax-year content
// that exceeds a single commit; we lay the foundation here so a
// follow-up commit just wires the template body.
//
// Output format:
//   - We render the document as HTML server-side.
//   - When a PDF is required (e-signature envelopes, IRS filing),
//     a callable converter takes that HTML and produces PDF bytes.
//     For v1 the converter is a stub that the firm uses to print
//     the HTML to PDF in-browser; full server-side PDF rendering
//     (Puppeteer / Playwright / Chromium fork) lands when we ship
//     the first auto-filed return.

export type EngagementLetterInput = {
  firm: {
    name: string;
    legal_name: string | null;
    address_line_1: string | null;
    address_city: string | null;
    address_region: string | null;
    address_postal_code: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    logo_url: string | null;
    accent_color: string | null;
  };
  client: {
    full_name: string | null;
    business_name: string | null;
    business_address: string | null;
    email: string;
  };
  engagement: {
    kind: "tax_prep" | "audit_support" | "bookkeeping" | "advisory";
    tax_year: number;
    scope_summary: string | null;
    fee_estimate_cents: number | null;
  };
  /** Effective date — typically today. */
  effective_date: string;
};

const KIND_NARRATIVE: Record<
  EngagementLetterInput["engagement"]["kind"],
  { headline: string; scope: string }
> = {
  tax_prep: {
    headline: "Federal and state income tax return preparation",
    scope:
      "We will prepare your federal and state income tax returns for the specified tax year, based on the information you provide. We will not audit, verify, or independently confirm the information you provide; we will rely on its accuracy and completeness. Returns will be prepared in accordance with the applicable laws, regulations, and IRS published guidance in effect on the date the returns are signed.",
  },
  audit_support: {
    headline: "Response to IRS or state tax notice",
    scope:
      "We will represent you in connection with the specified notice or examination. This engagement includes drafting the response, gathering supporting documentation, and communicating with the taxing authority on your behalf. It does not include preparation of amended returns unless explicitly added as a change order.",
  },
  bookkeeping: {
    headline: "Monthly bookkeeping and bank reconciliation",
    scope:
      "We will categorize transactions, reconcile bank and credit-card statements, and produce monthly profit-and-loss and balance-sheet reports for the specified period. We do not provide audit or assurance services; financial statements produced under this engagement are unaudited.",
  },
  advisory: {
    headline: "Tax and financial advisory services",
    scope:
      "We will provide tax planning, entity-selection, and quarterly advisory consultations as agreed in scope. Recommendations are provided based on the laws and regulations in effect on the date of the advice; tax law changes after that date may require revision.",
  },
};

export function generateEngagementLetterHTML(
  input: EngagementLetterInput,
): { html: string; filename: string } {
  const narrative = KIND_NARRATIVE[input.engagement.kind];
  const cta = input.firm.accent_color || "#0F2D24";
  const firmLegal = input.firm.legal_name || input.firm.name;
  const feeLine = input.engagement.fee_estimate_cents
    ? `<p><strong>Fee estimate.</strong> Our fee for the work described above is estimated at <strong>${formatCents(
        input.engagement.fee_estimate_cents,
      )}</strong>, payable per the invoice schedule. Out-of-scope work is billed separately at our standard rates and will be confirmed in writing before commencement.</p>`
    : `<p><strong>Fee estimate.</strong> Our fee will be provided in a separate invoice prior to commencement of work. Out-of-scope work is billed separately at our standard rates and will be confirmed in writing.</p>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Engagement letter — ${escapeHtml(input.firm.name)} for ${escapeHtml(input.client.business_name || input.client.full_name || input.client.email)}</title>
<style>
  @page { margin: 1in; }
  body { font-family: Georgia, "Times New Roman", serif; color: #18181B; line-height: 1.6; font-size: 12pt; }
  h1 { font-size: 18pt; margin: 0 0 12pt; color: ${cta}; }
  h2 { font-size: 13pt; margin: 24pt 0 8pt; color: ${cta}; }
  p { margin: 0 0 8pt; }
  ul { margin: 0 0 12pt 24pt; padding: 0; }
  li { margin-bottom: 4pt; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24pt; border-bottom: 1pt solid ${cta}; padding-bottom: 12pt; }
  .firm-block { font-size: 10pt; line-height: 1.4; color: #444; }
  .signature-block { margin-top: 36pt; display: grid; grid-template-columns: 1fr 1fr; gap: 48pt; }
  .signature-line { margin-top: 36pt; border-top: 1pt solid #18181B; padding-top: 4pt; font-size: 10pt; }
  .small { font-size: 10pt; color: #444; }
  .effective { margin-top: 24pt; font-size: 10pt; color: #444; }
</style>
</head>
<body>
  <div class="header">
    <div>
      ${input.firm.logo_url ? `<img src="${escapeAttr(input.firm.logo_url)}" alt="${escapeAttr(input.firm.name)}" style="max-height: 48pt; margin-bottom: 8pt;" />` : ""}
      <div style="font-size: 14pt; font-weight: bold; color: ${cta};">${escapeHtml(firmLegal)}</div>
    </div>
    <div class="firm-block">
      ${input.firm.address_line_1 ? `${escapeHtml(input.firm.address_line_1)}<br/>` : ""}
      ${input.firm.address_city ? `${escapeHtml(input.firm.address_city)}, ${escapeHtml(input.firm.address_region ?? "")} ${escapeHtml(input.firm.address_postal_code ?? "")}<br/>` : ""}
      ${input.firm.phone ? `${escapeHtml(input.firm.phone)}<br/>` : ""}
      ${input.firm.email ? `${escapeHtml(input.firm.email)}<br/>` : ""}
      ${input.firm.website ? `${escapeHtml(input.firm.website)}` : ""}
    </div>
  </div>

  <h1>Engagement letter</h1>
  <p class="effective"><strong>Effective:</strong> ${escapeHtml(formatDate(input.effective_date))} &nbsp;&middot;&nbsp; <strong>Tax year:</strong> ${input.engagement.tax_year}</p>

  <p>Dear ${escapeHtml(input.client.full_name || input.client.business_name || "Client")},</p>

  <p>Thank you for choosing ${escapeHtml(input.firm.name)}. This letter confirms the terms of our engagement and the services we will provide. Please review it carefully, sign below, and return one copy to our office.</p>

  <h2>1. Scope of services</h2>
  <p><strong>${escapeHtml(narrative.headline)}.</strong></p>
  <p>${escapeHtml(narrative.scope)}</p>
  ${input.engagement.scope_summary ? `<p><strong>Additional scope (engagement-specific):</strong> ${escapeHtml(input.engagement.scope_summary)}</p>` : ""}

  <h2>2. Your responsibilities</h2>
  <ul>
    <li>Provide complete and accurate information on a timely basis, including all records required to substantiate income, deductions, and credits claimed.</li>
    <li>Sign and return all required forms and authorizations, including IRS Forms 8879 (e-file authorization) and applicable state equivalents.</li>
    <li>Notify us promptly of any changes to your information, contact details, or filing status.</li>
    <li>Retain all original documents and records as required by applicable law (generally three years from the filing date).</li>
  </ul>

  <h2>3. Our responsibilities</h2>
  <ul>
    <li>Perform the services described in Section 1 in accordance with applicable professional standards.</li>
    <li>Treat all client information as confidential and not disclose it without your written consent, except as required by law or to comply with regulatory or professional standards.</li>
    <li>Notify you promptly of any issue that materially affects the engagement or the services provided.</li>
  </ul>

  <h2>4. Fees</h2>
  ${feeLine}

  <h2>5. Limitation of liability</h2>
  <p>Our liability to you under this engagement, whether in contract, tort, or otherwise, is limited to the fees paid for the specific services giving rise to the claim. We are not liable for consequential, indirect, or punitive damages. Nothing in this letter limits liability for matters that cannot be limited under applicable law.</p>

  <h2>6. Records retention</h2>
  <p>We will retain copies of returns and supporting workpapers for seven (7) years from the date of filing, after which they may be destroyed without further notice. Original documents you provide will be returned to you on completion of the engagement.</p>

  <h2>7. Termination</h2>
  <p>Either party may terminate this engagement upon written notice. You will be invoiced for services rendered through the date of termination.</p>

  <h2>8. Governing law</h2>
  <p>This engagement is governed by the laws of the state where our firm is registered. Any disputes arising under it will be resolved in the state and federal courts of that jurisdiction.</p>

  <h2>9. Acceptance</h2>
  <p>By signing below, you acknowledge that you have read this letter, agree to its terms, and authorize us to begin the services described.</p>

  <div class="signature-block">
    <div>
      <div class="signature-line">Client signature</div>
      <p class="small">${escapeHtml(input.client.full_name || "")}<br/>${escapeHtml(input.client.business_name || "")}</p>
      <div class="signature-line">Date</div>
    </div>
    <div>
      <div class="signature-line">Firm authorized signatory</div>
      <p class="small">${escapeHtml(firmLegal)}</p>
      <div class="signature-line">Date</div>
    </div>
  </div>
</body>
</html>`;

  const filename = `engagement-letter-${slugify(input.client.business_name || input.client.full_name || input.client.email)}-${input.engagement.tax_year}.html`;
  return { html, filename };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

function formatCents(c: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(c / 100);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
