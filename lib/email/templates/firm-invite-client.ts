/**
 * Email body builders for the firm → client invitation flow.
 *
 * Two recipient variants:
 *   - existing Taxottic user: link to the in-app engagement
 *     acceptance page (`/c/{publicId}/preparer?engagementId=...`)
 *   - prospect not on Taxottic: link to `/login?next=/dashboard` so
 *     they create an account; the `pending_firm_outreach_for_me()`
 *     RPC will surface the pending firm engagement on first login.
 *
 * We hand-roll the HTML rather than ship a Handlebars / React-email
 * dependency. Three keep-it-simple rules:
 *   1. Inline styles only. Email clients strip <style> blocks.
 *   2. No background images. Gmail / Outlook quietly drop them.
 *   3. A plain-text fallback that doesn't lose key info.
 */

export type FirmInviteClientArgs = {
  firmName: string;
  firmSlug: string;
  /** Logo URL, public-readable. Falls back to no logo if absent. */
  firmLogoUrl?: string | null;
  /** Optional accent color (hex) used on the CTA button. */
  firmAccentColor?: string | null;
  /** Recipient name; pulled from outreach.full_name when known. */
  recipientName?: string | null;
  /** Engagement kind, pre-formatted. */
  engagementKindLabel: string;
  /** Tax year of the engagement, e.g. 2026. */
  taxYear: number;
  /** Personal note from the inviter, freeform. */
  message?: string | null;
  /** Inviter display name (e.g. "Riley Smith") for the signature. */
  inviterName?: string | null;
  /** Inviter reply-to email. Used in the Reply-To header so the
   *  client's reply lands in the inviter's inbox. */
  inviterEmail?: string | null;
  /** The acceptance URL. Caller composes this so we don't have to
   *  know about routing. */
  acceptUrl: string;
  /** Optional decline / not-me URL. Lower-friction than dropping
   *  the email and helps with deliverability. */
  declineUrl?: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  fromName: string;
};

export function renderFirmInviteClientEmail(
  args: FirmInviteClientArgs,
): RenderedEmail {
  const greet = args.recipientName
    ? `Hi ${escapeHtml(args.recipientName.split(" ")[0])},`
    : "Hi,";
  const cta = args.firmAccentColor || "#1d2843";
  const portalUrl = `https://${args.firmSlug}.taxottic.com`;
  const subject = `${args.firmName} invited you to a ${args.engagementKindLabel} engagement on Taxottic`;
  const inviterLine = args.inviterName
    ? `${escapeHtml(args.inviterName)} at ${escapeHtml(args.firmName)}`
    : escapeHtml(args.firmName);
  const personalNote = args.message
    ? `<p style="margin: 0 0 16px; color: #18181B; font-size: 14px; line-height: 1.6;">
         <em>${escapeHtml(args.message)}</em>
       </p>`
    : "";
  const logoLine = args.firmLogoUrl
    ? `<img src="${escapeAttr(args.firmLogoUrl)}" alt="${escapeAttr(args.firmName)}" style="height: 32px; width: auto; margin-bottom: 24px;" />`
    : `<div style="font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 600; color: #1d2843; margin-bottom: 24px;">${escapeHtml(args.firmName)}</div>`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #F5EDD6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #F5EDD6;">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background-color: #FFFFFF; border-radius: 16px; box-shadow: 0 2px 24px rgba(29, 40, 67, 0.08); max-width: 560px;">
            <tr>
              <td style="padding: 32px 32px 24px;">
                ${logoLine}
                <h1 style="font-family: Georgia, 'Times New Roman', serif; font-size: 22px; color: #1d2843; margin: 0 0 16px; line-height: 1.3;">
                  ${greet}
                </h1>
                <p style="margin: 0 0 16px; color: #18181B; font-size: 14px; line-height: 1.6;">
                  ${inviterLine} invited you to a <strong>${escapeHtml(args.engagementKindLabel)}</strong> engagement for tax year <strong>${args.taxYear}</strong> on Taxottic.
                </p>
                ${personalNote}
                <p style="margin: 0 0 24px; color: #18181B; font-size: 14px; line-height: 1.6;">
                  Click the button below to accept. We'll either log you into your existing Taxottic account, or walk you through creating one in about 60 seconds.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="background-color: ${escapeAttr(cta)}; border-radius: 999px;">
                      <a href="${escapeAttr(args.acceptUrl)}" style="display: inline-block; padding: 12px 24px; color: #F5EDD6; text-decoration: none; font-size: 14px; font-weight: 500;">
                        Accept engagement →
                      </a>
                    </td>
                  </tr>
                </table>
                ${
                  args.declineUrl
                    ? `<p style="margin: 24px 0 0; color: #71717A; font-size: 12px; line-height: 1.5;">
                         Not you, or not interested? <a href="${escapeAttr(args.declineUrl)}" style="color: #71717A;">Let us know</a> and we won't email you again.
                       </p>`
                    : ""
                }
                <hr style="border: none; border-top: 1px solid #E5E5E5; margin: 32px 0 24px;" />
                <p style="margin: 0; color: #71717A; font-size: 11px; line-height: 1.6;">
                  ${escapeHtml(args.firmName)} runs their firm portal at <a href="${escapeAttr(portalUrl)}" style="color: #71717A;">${escapeHtml(args.firmSlug)}.taxottic.com</a>. Taxottic is the platform; your relationship is with ${escapeHtml(args.firmName)}.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text =
    `${args.recipientName ? `Hi ${args.recipientName.split(" ")[0]},` : "Hi,"}\n\n` +
    `${args.inviterName ? `${args.inviterName} at ${args.firmName}` : args.firmName} invited you to a ${args.engagementKindLabel} engagement for tax year ${args.taxYear} on Taxottic.\n\n` +
    (args.message ? `${args.message}\n\n` : "") +
    `Accept the engagement here:\n${args.acceptUrl}\n\n` +
    (args.declineUrl ? `Not you? ${args.declineUrl}\n\n` : "") +
    `${args.firmName} runs their portal at ${portalUrl}.\n` +
    `Taxottic is the platform; your relationship is with ${args.firmName}.`;

  return {
    subject,
    html,
    text,
    replyTo: args.inviterEmail || undefined,
    fromName: args.firmName,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
