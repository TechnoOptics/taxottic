// Email body for beta / TestFlight invitations. Sent when we invite someone
// to test a pre-release Taxottic build (Apple TestFlight on iOS, Google Play
// beta on Android). Mirrors the visual language of the other invite templates
// (renderCompanyMemberInviteEmail) so beta invites feel first-party, not like
// a raw store link.
//
// Production-only asset host: sendEmail() only has a real provider configured
// in production (RESEND_API_KEY is prod-only, see lib/email/transport.ts), so
// a hardcoded canonical domain is safe here the same way it is in
// app/robots.ts and app/sitemap.ts.
const TAXOTTIC_LOGO_URL = "https://taxottic.com/brand/full-logo.png";
// The tester checklist page (app/beta). Canonical prod domain, same rationale
// as the logo URL above.
const BETA_CHECKLIST_URL = "https://taxottic.com/beta";

export type BetaInviteArgs = {
  /** Recipient's name, for the greeting. */
  recipientName?: string | null;
  /** Who's doing the inviting, shown in the intro line and as the from-name. */
  inviterName?: string | null;
  /** Which beta channel the link points at. Drives the install steps and the
   *  button label. "both" covers a joint invite (iOS + Android). */
  platform?: "ios" | "android" | "both";
  /** The TestFlight public link / redeem URL (or Play opt-in URL). */
  inviteUrl: string;
  /** Optional note from the inviter, rendered as a quoted block. */
  personalMessage?: string | null;
  /** Optional "please look at these" bullets for the tester. */
  focusAreas?: string[];
};

const PLATFORM_COPY: Record<
  NonNullable<BetaInviteArgs["platform"]>,
  { label: string; steps: string[] }
> = {
  ios: {
    label: "Open in TestFlight",
    steps: [
      "Install Apple's free TestFlight app from the App Store.",
      "Tap the button below to add Taxottic, then tap Install.",
      "Open Taxottic, sign in, and take a look around.",
    ],
  },
  android: {
    label: "Join on Google Play",
    steps: [
      "Tap the button below to join the Taxottic beta on Google Play.",
      "Install or update Taxottic from the Play Store.",
      "Open Taxottic, sign in, and take a look around.",
    ],
  },
  both: {
    label: "Get the beta",
    steps: [
      "On iPhone, install Apple's free TestFlight app first. On Android, you'll join straight through Google Play.",
      "Tap the button below to add Taxottic, then install it.",
      "Open Taxottic, sign in, and take a look around.",
    ],
  },
};

export function renderBetaInviteEmail(
  args: BetaInviteArgs,
): { subject: string; html: string; text: string; fromName: string } {
  const navy = "#1d2843";
  const cream = "#F5EDD6";
  const gold = "#C4A25D";
  const goldLight = "#E0C590";
  const inkSoft = "#3F3F46";
  const muted = "#8A661F";

  const platform = args.platform ?? "ios";
  const copy = PLATFORM_COPY[platform];

  const firstName = args.recipientName?.split(" ")[0];
  const greet = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";
  const inviter = args.inviterName ? escapeHtml(args.inviterName) : null;
  const subject = inviter
    ? `${args.inviterName} invited you to test Taxottic`
    : "You're invited to test Taxottic";
  const preheader = "Try the Taxottic beta and tell us what you think.";

  const introLine = inviter
    ? `${inviter} invited you to help test Taxottic before it ships.`
    : "You're invited to help test Taxottic before it ships.";

  const stepsHtml = copy.steps
    .map(
      (s, i) =>
        `<tr>
          <td style="vertical-align: top; padding: 0 12px 12px 0;">
            <div style="width: 24px; height: 24px; border-radius: 999px; background: #FBF7E9; border: 1px solid #EDE4CB; text-align: center; line-height: 24px; font-family: Georgia, 'Times New Roman', serif; font-size: 13px; font-weight: 600; color: ${navy};">${i + 1}</div>
          </td>
          <td style="vertical-align: top; padding: 0 0 12px; color: ${inkSoft}; font-size: 14.5px; line-height: 1.6;">${escapeHtml(s)}</td>
        </tr>`,
    )
    .join("");

  const messageBlock = args.personalMessage
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px;"><tr>
        <td style="width: 4px; background: ${goldLight}; border-radius: 4px 0 0 4px;"></td>
        <td style="padding: 14px 18px; background: #FBF7E9; border-radius: 0 10px 10px 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 14.5px; line-height: 1.6; color: ${inkSoft};">
          &ldquo;${escapeHtml(args.personalMessage)}&rdquo;
        </td>
      </tr></table>`
    : "";

  const focusBlock =
    args.focusAreas && args.focusAreas.length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 4px 0 20px;">
          <tr><td style="padding: 0 0 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: ${muted};">A few things to look at</td></tr>
          ${args.focusAreas
            .map(
              (f) =>
                `<tr><td style="padding: 0 0 6px; color: ${inkSoft}; font-size: 14.5px; line-height: 1.6;">&bull;&nbsp; ${escapeHtml(f)}</td></tr>`,
            )
            .join("")}
        </table>`
      : "";

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: ${cream}; margin: 0; padding: 40px 16px;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width: 560px; max-width: 560px; background: #FFFFFF; border-radius: 20px; border: 1px solid #EEE5D0; overflow: hidden;">
        <tr><td style="height: 5px; background: linear-gradient(90deg, ${goldLight}, ${gold}); font-size: 0; line-height: 0;">&nbsp;</td></tr>
        <tr><td style="padding: 32px 40px 0;">
          <img src="${TAXOTTIC_LOGO_URL}" alt="Taxottic" height="22" style="display: block; height: 22px; width: auto;" />
        </td></tr>
        <tr><td style="padding: 26px 40px 0;">
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: ${muted};">Beta invitation</div>
          <h1 style="font-family: Georgia, 'Times New Roman', serif; font-size: 25px; font-weight: 600; color: ${navy}; margin: 8px 0 18px; line-height: 1.3;">${greet}</h1>
          <p style="margin: 0 0 14px; color: ${inkSoft}; font-size: 15px; line-height: 1.7;">
            ${introLine} Taxottic forecasts taxes for freelancers and small businesses, and your early feedback shapes what ships.
          </p>
          ${messageBlock}
        </td></tr>
        <tr><td style="padding: 6px 40px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${stepsHtml}</table>
        </td></tr>
        <tr><td style="padding: 8px 40px 8px;" align="center">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius: 999px; background: ${navy}; box-shadow: 0 6px 16px rgba(29, 40, 67, 0.22);">
            <a href="${escapeAttr(args.inviteUrl)}" style="display: inline-block; padding: 15px 36px; color: ${cream}; text-decoration: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; font-weight: 600; letter-spacing: 0.01em;">${escapeHtml(copy.label)} &rarr;</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding: 22px 40px 0;">
          ${focusBlock}
          <p style="margin: 0 0 12px; color: ${inkSoft}; font-size: 14px; line-height: 1.7;">
            Once you&rsquo;re in, we put together a short checklist of what to try:
            <a href="${escapeAttr(BETA_CHECKLIST_URL)}" style="color: ${navy}; font-weight: 600; text-decoration: underline;">taxottic.com/beta</a>.
          </p>
          <p style="margin: 0; color: ${inkSoft}; font-size: 14px; line-height: 1.7;">
            To send feedback, take a screenshot inside the app and you'll be prompted to add a note, or just reply to this email.
          </p>
        </td></tr>
        <tr><td style="padding: 28px 40px 28px;">
          <div style="border-top: 1px solid #F1E9D4; padding-top: 20px;">
            <p style="margin: 0; color: #A1A1AA; font-size: 11.5px; line-height: 1.6;">
              Beta builds refresh over the test period and expire after 90 days. If you weren&rsquo;t expecting this, you can safely ignore this email.
            </p>
          </div>
        </td></tr>
      </table>
      <p style="margin: 20px 0 0; color: #B8A87A; font-size: 11px; letter-spacing: 0.04em;">Taxottic &middot; Tax forecasting for freelancers &amp; small business</p>
    </td></tr></table>
  </body>
</html>`;

  const text =
    `${firstName ? `Hi ${firstName},` : "Hi,"}\n\n` +
    `${introLine} Taxottic forecasts taxes for freelancers and small businesses, and your early feedback shapes what ships.\n\n` +
    (args.personalMessage ? `"${args.personalMessage}"\n\n` : "") +
    `How to get the beta:\n` +
    copy.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") +
    `\n\nGet the beta:\n${args.inviteUrl}\n\n` +
    (args.focusAreas && args.focusAreas.length > 0
      ? `A few things to look at:\n${args.focusAreas.map((f) => `- ${f}`).join("\n")}\n\n`
      : "") +
    `Once you're in, a short checklist of what to try:\n${BETA_CHECKLIST_URL}\n\n` +
    `To send feedback, take a screenshot in the app and add a note, or reply to this email.\n\n` +
    `Beta builds expire after 90 days. If you weren't expecting this, you can ignore it.`;

  return {
    subject,
    html,
    text,
    fromName: args.inviterName ?? "Taxottic",
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
