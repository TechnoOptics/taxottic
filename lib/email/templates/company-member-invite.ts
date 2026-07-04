// Email body for company team-member invitations (the consumer app's
// "Add an employee" flow on /c/[publicId]/manage). Distinct from the
// firm-member-invite template: this is "join this small business's
// Taxottic team as an employee," not "join our accounting firm."

// Production-only asset host: sendEmail() only has a real provider
// configured in production (RESEND_API_KEY is prod-only, see
// lib/email/transport.ts), so a hardcoded canonical domain is safe here
// the same way it already is in app/robots.ts and app/sitemap.ts.
const TAXOTTIC_LOGO_URL = "https://taxottic.com/brand/full-logo.png";

export type CompanyMemberInviteArgs = {
  companyName: string;
  /** companies.logo_url, shown next to the company name when set.
   *  Falls back to the same champagne monogram tile used in-app
   *  (see components/CompanyLogo.tsx) when null. */
  companyLogoUrl?: string | null;
  inviterName?: string | null;
  recipientName?: string | null;
  role: "member" | "lead" | "manager" | "expenser";
  title?: string | null;
  personalMessage?: string | null;
  inviteUrl: string;
};

const ROLE_NARRATIVE: Record<
  CompanyMemberInviteArgs["role"],
  { headline: string; rights: string }
> = {
  expenser: {
    headline: "to log expenses",
    rights:
      "You'll be able to log your own expenses, track business mileage, and chat with the team on Taxottic.",
  },
  member: {
    headline: "as a team member",
    rights:
      "You'll be able to log your own expenses, track business mileage, and chat with the team on Taxottic.",
  },
  lead: {
    headline: "as a department lead",
    rights:
      "You'll be able to log your own expenses and mileage, plus review and reclassify expenses for your department's team members on Taxottic.",
  },
  manager: {
    headline: "as a manager",
    rights:
      "You'll be able to invite other teammates, review expenses and mileage, and see the full company forecast on Taxottic.",
  },
};

export function renderCompanyMemberInviteEmail(
  args: CompanyMemberInviteArgs,
): { subject: string; html: string; text: string; fromName: string } {
  const navy = "#1d2843";
  const cream = "#F5EDD6";
  const gold = "#C4A25D";
  const goldLight = "#E0C590";
  const inkSoft = "#3F3F46";
  const muted = "#8A661F";

  const firstName = args.recipientName?.split(" ")[0];
  const greet = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";
  const narrative = ROLE_NARRATIVE[args.role];
  const inviterLine = args.inviterName
    ? `${escapeHtml(args.inviterName)} at ${escapeHtml(args.companyName)}`
    : escapeHtml(args.companyName);
  const subject = `You're invited to join ${args.companyName} on Taxottic`;
  const preheader = `${inviterLine} added you ${narrative.headline}, accept your invite below.`;

  // Company badge: the uploaded logo when present, otherwise the same
  // champagne-gradient monogram tile CompanyLogo.tsx falls back to
  // in-app, so the email still feels branded rather than generic.
  const monogram = escapeHtml(
    (args.companyName.trim().charAt(0) || "T").toUpperCase(),
  );
  const companyBadge = args.companyLogoUrl
    ? `<img src="${escapeAttr(args.companyLogoUrl)}" width="44" height="44" alt="${escapeAttr(args.companyName)} logo" style="display: block; width: 44px; height: 44px; border-radius: 12px; object-fit: contain; background: #FFFFFF; border: 1px solid #EDE4CB;" />`
    : `<div style="width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #FBF7E9, #F5EDD6); border: 1px solid #EDE4CB; text-align: center; line-height: 44px; font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 600; color: ${navy};">${monogram}</div>`;

  const messageBlock = args.personalMessage
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px;"><tr>
        <td style="width: 4px; background: ${goldLight}; border-radius: 4px 0 0 4px;"></td>
        <td style="padding: 14px 18px; background: #FBF7E9; border-radius: 0 10px 10px 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 14.5px; line-height: 1.6; color: ${inkSoft};">
          &ldquo;${escapeHtml(args.personalMessage)}&rdquo;
        </td>
      </tr></table>`
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
        <tr><td style="padding: 28px 40px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right: 12px;">${companyBadge}</td>
            <td style="vertical-align: middle;">
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: ${muted};">You&rsquo;re invited</div>
              <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 600; color: ${navy}; margin-top: 2px;">${escapeHtml(args.companyName)}</div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding: 24px 40px 0;">
          <h1 style="font-family: Georgia, 'Times New Roman', serif; font-size: 25px; font-weight: 600; color: ${navy}; margin: 0 0 18px; line-height: 1.3;">${greet}</h1>
          <p style="margin: 0 0 14px; color: ${inkSoft}; font-size: 15px; line-height: 1.7;">
            ${inviterLine} added you to their team ${escapeHtml(narrative.headline)} on Taxottic${args.title ? ` (${escapeHtml(args.title)})` : ""}.
          </p>
          <p style="margin: 0 0 20px; color: ${inkSoft}; font-size: 15px; line-height: 1.7;">
            ${escapeHtml(narrative.rights)}
          </p>
          ${messageBlock}
        </td></tr>
        <tr><td style="padding: 4px 40px 8px;" align="center">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius: 999px; background: ${navy}; box-shadow: 0 6px 16px rgba(29, 40, 67, 0.22);">
            <a href="${escapeAttr(args.inviteUrl)}" style="display: inline-block; padding: 15px 36px; color: ${cream}; text-decoration: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; font-weight: 600; letter-spacing: 0.01em;">Join ${escapeHtml(args.companyName)} &rarr;</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding: 14px 40px 0;" align="center">
          <p style="margin: 0; color: #A1A1AA; font-size: 12.5px; line-height: 1.6;">
            You&rsquo;ll be logged into your existing Taxottic account, or walked through creating one in about 60 seconds.
          </p>
        </td></tr>
        <tr><td style="padding: 32px 40px 28px;">
          <div style="border-top: 1px solid #F1E9D4; padding-top: 20px;">
            <p style="margin: 0; color: #A1A1AA; font-size: 11.5px; line-height: 1.6;">
              This invitation expires in 14 days. If you weren&rsquo;t expecting it, you can safely ignore this email.
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
    `${args.inviterName ? `${args.inviterName} at ${args.companyName}` : args.companyName} added you to their team ${narrative.headline} on Taxottic${args.title ? ` (${args.title})` : ""}.\n\n` +
    `${narrative.rights}\n\n` +
    (args.personalMessage ? `"${args.personalMessage}"\n\n` : "") +
    `Accept the invitation:\n${args.inviteUrl}\n\n` +
    `Expires in 14 days. If you weren't expecting this email, you can ignore it.`;

  return {
    subject,
    html,
    text,
    fromName: args.companyName,
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
