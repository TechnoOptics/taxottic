// Email body for a W-9 request from a firm to a contractor.
//
// Tone is professional but not bureaucratic: this is a quick form
// the recipient needs to complete so the firm can issue them a
// 1099. We don't ask the recipient to upload their existing W-9 —
// fields go directly into our database, signed in-app.

export type W9RequestArgs = {
  firmName: string;
  firmLogoUrl?: string | null;
  firmAccentColor?: string | null;
  inviterName?: string | null;
  inviterEmail?: string | null;
  recipientName?: string | null;
  /** The /w9/{token} fill URL. */
  fillUrl: string;
  /** When the token expires. ISO. */
  expiresAt: string;
};

export function renderW9RequestEmail(args: W9RequestArgs): {
  subject: string;
  html: string;
  text: string;
  fromName: string;
  replyTo?: string;
} {
  const cta = args.firmAccentColor || "#0F2D24";
  const greet = args.recipientName
    ? `Hi ${escapeHtml(args.recipientName.split(" ")[0])},`
    : "Hi,";
  const inviterLine = args.inviterName
    ? `${escapeHtml(args.inviterName)} at ${escapeHtml(args.firmName)}`
    : escapeHtml(args.firmName);
  const expires = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(args.expiresAt));

  const logoLine = args.firmLogoUrl
    ? `<img src="${escapeAttr(args.firmLogoUrl)}" alt="${escapeAttr(args.firmName)}" style="height: 32px; width: auto; margin-bottom: 24px;" />`
    : `<div style="font-family: Georgia, serif; font-size: 18px; font-weight: 600; color: #0F2D24; margin-bottom: 24px;">${escapeHtml(args.firmName)}</div>`;

  const subject = `${args.firmName} needs your W-9 (takes 2 minutes)`;
  const html = `<!doctype html><html><body style="font-family: -apple-system, sans-serif; background: #F5EDD6; margin: 0; padding: 32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" style="background: #FFFFFF; border-radius: 16px; max-width: 560px;"><tr><td style="padding: 32px;">
        ${logoLine}
        <h1 style="font-family: Georgia, serif; font-size: 22px; color: #0F2D24; margin: 0 0 16px;">${greet}</h1>
        <p style="margin: 0 0 16px; color: #18181B; font-size: 14px; line-height: 1.6;">
          ${inviterLine} needs your IRS Form W-9 before issuing your end-of-year 1099. The form captures your legal name, taxpayer identification number (SSN or EIN), and address.
        </p>
        <p style="margin: 0 0 16px; color: #18181B; font-size: 14px; line-height: 1.6;">
          Why we ask: the IRS requires payers to collect a W-9 from any contractor paid $600+ in a calendar year. Without it, the payer has to withhold 24% backup tax — and you don't want that.
        </p>
        <p style="margin: 0 0 24px; color: #18181B; font-size: 14px; line-height: 1.6;">
          Click below to fill the form. It takes about two minutes; all data is transmitted encrypted and stored on Taxottic's secure platform.
        </p>
        <a href="${escapeAttr(args.fillUrl)}" style="display: inline-block; padding: 12px 24px; background: ${escapeAttr(cta)}; color: #F5EDD6; text-decoration: none; border-radius: 999px; font-size: 14px;">Fill out your W-9 →</a>
        <p style="margin: 16px 0 0; color: #71717A; font-size: 11px; line-height: 1.6;">
          This request expires on ${escapeHtml(expires)}. If you don't recognize this email, you can safely ignore it.
        </p>
        <hr style="border: none; border-top: 1px solid #E5E5E5; margin: 32px 0 16px;" />
        <p style="margin: 0; color: #71717A; font-size: 11px; line-height: 1.6;">
          Questions? Reply directly — this email is sent on behalf of ${escapeHtml(args.firmName)} via Taxottic.
        </p>
      </td></tr></table>
    </td></tr></table>
  </body></html>`;

  const text =
    `${args.recipientName ? `Hi ${args.recipientName.split(" ")[0]},` : "Hi,"}\n\n` +
    `${args.inviterName ? `${args.inviterName} at ${args.firmName}` : args.firmName} needs your IRS Form W-9 before issuing your end-of-year 1099.\n\n` +
    `Why: the IRS requires payers to collect a W-9 from any contractor paid $600+. Without it, the payer has to withhold 24% backup tax.\n\n` +
    `Fill the form: ${args.fillUrl}\n\n` +
    `This request expires on ${expires}.\n\n` +
    `Questions? Reply directly — this email is sent on behalf of ${args.firmName} via Taxottic.`;

  return {
    subject,
    html,
    text,
    fromName: args.firmName,
    replyTo: args.inviterEmail ?? undefined,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
