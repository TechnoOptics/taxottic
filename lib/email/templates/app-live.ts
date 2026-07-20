// "The app is live, here's how to install it" email.
//
// Distinct from renderBetaInviteEmail: that one says the app is being
// tested "before it ships", which stopped being true when 1.2.0 went
// public on both stores. This template is for people we're pointing at
// the PUBLIC listings, so it never mentions TestFlight or beta opt-in.
//
// Production-only asset host: sendEmail() only has a real provider in
// production (RESEND_API_KEY is prod-only, see lib/email/transport.ts),
// so the canonical domain is safe here, same rationale as app/robots.ts.
const TAXOTTIC_LOGO_URL = "https://taxottic.com/brand/full-logo.png";

export type AppLiveArgs = {
  /** Recipient's name, for the greeting. */
  recipientName?: string | null;
  /** Shown as the from-name and in the intro line. */
  senderName?: string | null;
  /** Where to send them. The one link that serves the right store per
   *  device (app/get), so this email never has to name a platform. */
  installUrl: string;
  /** Optional note, rendered as a quoted block. */
  personalMessage?: string | null;
  /** Optional "what changed" bullets. */
  highlights?: string[];
};

export function renderAppLiveEmail(args: AppLiveArgs): {
  subject: string;
  html: string;
  text: string;
  fromName: string;
} {
  const navy = "#1d2843";
  const cream = "#F5EDD6";
  const gold = "#C4A25D";
  const goldLight = "#E0C590";
  const inkSoft = "#3F3F46";

  const firstName = args.recipientName?.split(" ")[0];
  const greet = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";
  const sender = args.senderName ? escapeHtml(args.senderName) : null;
  const subject = "Taxottic is live, install the latest version";
  const preheader =
    "The new version is on the App Store and Google Play. One link installs it.";

  const introLine = sender
    ? `${sender} sent you the latest version of Taxottic.`
    : "The latest version of Taxottic is ready to install.";

  const highlightsHtml = (args.highlights ?? [])
    .map(
      (h) =>
        `<tr>
          <td style="vertical-align: top; padding: 0 10px 10px 0; color: ${gold}; font-size: 14px; line-height: 1.6;">&bull;</td>
          <td style="vertical-align: top; padding: 0 0 10px; color: ${inkSoft}; font-size: 14.5px; line-height: 1.6;">${escapeHtml(h)}</td>
        </tr>`,
    )
    .join("");

  const messageBlock = args.personalMessage
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px;"><tr>
        <td style="width: 4px; background: ${goldLight}; border-radius: 4px 0 0 4px;"></td>
        <td style="padding: 2px 0 2px 14px; color: ${inkSoft}; font-size: 14.5px; line-height: 1.65; font-style: italic;">${escapeHtml(args.personalMessage)}</td>
      </tr></table>`
    : "";

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin: 0; padding: 0; background: #FBF7E9;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #FBF7E9; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background: #FFFFFF; border: 1px solid #EDE4CB; border-radius: 14px; overflow: hidden;">
            <tr>
              <td style="padding: 28px 32px 0;">
                <img src="${TAXOTTIC_LOGO_URL}" alt="Taxottic" width="132" style="display: block; border: 0; max-width: 132px;" />
              </td>
            </tr>
            <tr>
              <td style="padding: 24px 32px 0; color: ${navy}; font-family: Georgia, 'Times New Roman', serif; font-size: 24px; line-height: 1.3;">
                Taxottic is live
              </td>
            </tr>
            <tr>
              <td style="padding: 14px 32px 0; color: ${inkSoft}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.65;">
                ${greet}<br /><br />
                ${introLine} It is on the App&nbsp;Store and Google&nbsp;Play now, so there is no invite code or beta signup to deal with.
              </td>
            </tr>
            ${
              messageBlock
                ? `<tr><td style="padding: 20px 32px 0;">${messageBlock}</td></tr>`
                : ""
            }
            ${
              highlightsHtml
                ? `<tr><td style="padding: 20px 32px 0;">
                     <div style="color: ${navy}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 12px;">What's new</div>
                     <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${highlightsHtml}</table>
                   </td></tr>`
                : ""
            }
            <tr>
              <td align="center" style="padding: 28px 32px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background: ${navy}; border-radius: 8px;">
                      <a href="${escapeAttr(args.installUrl)}" style="display: inline-block; padding: 15px 36px; color: ${cream}; text-decoration: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; font-weight: 600; letter-spacing: 0.01em;">Install Taxottic &rarr;</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 32px 0; color: #8A661F; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 1.6; text-align: center;">
                Open this on your phone and the link sends you to the right store automatically.
              </td>
            </tr>
            <tr>
              <td style="padding: 24px 32px 30px; color: ${inkSoft}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13.5px; line-height: 1.6;">
                Already have it installed? It updates on its own, but you can open the store page from the same link to update right away.
              </td>
            </tr>
          </table>
          <div style="max-width: 560px; margin: 18px auto 0; color: #8A661F; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; line-height: 1.6; text-align: center;">
            ${escapeHtml(args.installUrl)}
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textLines = [
    greet.replace(/<[^>]*>/g, ""),
    "",
    `${sender ? `${args.senderName} sent you the latest version of Taxottic.` : "The latest version of Taxottic is ready to install."} It is on the App Store and Google Play now, so there is no invite code or beta signup.`,
  ];
  if (args.personalMessage) textLines.push("", `"${args.personalMessage}"`);
  if (args.highlights?.length) {
    textLines.push("", "What's new:");
    for (const h of args.highlights) textLines.push(`  - ${h}`);
  }
  textLines.push(
    "",
    "Install it here:",
    args.installUrl,
    "",
    "Open that on your phone and it sends you to the right store automatically.",
  );

  return {
    subject,
    html,
    text: textLines.join("\n"),
    fromName: args.senderName ? `${args.senderName} via Taxottic` : "Taxottic",
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
