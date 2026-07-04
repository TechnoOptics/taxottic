// Email body for firm-member invitations. Different from
// firm-invite-client.ts: this is "join our firm as a preparer/
// reviewer/manager," not "be our client." Subject line + body
// reflect that.

export type FirmMemberInviteArgs = {
  firmName: string;
  firmLogoUrl?: string | null;
  firmAccentColor?: string | null;
  inviterName?: string | null;
  recipientName?: string | null;
  role: "owner" | "manager" | "preparer" | "reviewer";
  title?: string | null;
  inviteUrl: string;
};

const ROLE_NARRATIVE: Record<
  FirmMemberInviteArgs["role"],
  { headline: string; rights: string }
> = {
  owner: {
    headline: "as an owner",
    rights:
      "Owners have full access to every client engagement, document, invoice, and firm setting. The owner role is for firm partners.",
  },
  manager: {
    headline: "as a manager",
    rights:
      "Managers can invite team members, manage all client engagements, send invoices, and configure firm settings, but can't transfer ownership.",
  },
  preparer: {
    headline: "as a preparer",
    rights:
      "Preparers see and work on engagements assigned to them. They can prepare documents and draft tax returns, but invoices + member management stay with managers.",
  },
  reviewer: {
    headline: "as a reviewer",
    rights:
      "Reviewers see assigned engagements in read-only mode. The reviewer role is for senior staff who sign off on preparer work without doing the work themselves.",
  },
};

export function renderFirmMemberInviteEmail(
  args: FirmMemberInviteArgs,
): { subject: string; html: string; text: string; fromName: string } {
  const cta = args.firmAccentColor || "#1d2843";
  const greet = args.recipientName
    ? `Hi ${escapeHtml(args.recipientName.split(" ")[0])},`
    : "Hi,";
  const narrative = ROLE_NARRATIVE[args.role];
  const inviterLine = args.inviterName
    ? `${escapeHtml(args.inviterName)} at ${escapeHtml(args.firmName)}`
    : escapeHtml(args.firmName);
  const subject = `${args.firmName} invited you to join the firm on Taxottic`;
  const logoLine = args.firmLogoUrl
    ? `<img src="${escapeAttr(args.firmLogoUrl)}" alt="${escapeAttr(args.firmName)}" style="height: 32px; width: auto; margin-bottom: 24px;" />`
    : `<div style="font-family: Georgia, serif; font-size: 18px; font-weight: 600; color: #1d2843; margin-bottom: 24px;">${escapeHtml(args.firmName)}</div>`;

  const html = `<!doctype html><html><body style="font-family: -apple-system, sans-serif; background: #F5EDD6; margin: 0; padding: 32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" style="background: #FFFFFF; border-radius: 16px; max-width: 560px;"><tr><td style="padding: 32px;">
        ${logoLine}
        <h1 style="font-family: Georgia, serif; font-size: 22px; color: #1d2843; margin: 0 0 16px; line-height: 1.3;">${greet}</h1>
        <p style="margin: 0 0 16px; color: #18181B; font-size: 14px; line-height: 1.6;">
          ${inviterLine} invited you to join the firm ${escapeHtml(narrative.headline)} on Taxottic${args.title ? ` (${escapeHtml(args.title)})` : ""}.
        </p>
        <p style="margin: 0 0 16px; color: #18181B; font-size: 14px; line-height: 1.6;">
          ${escapeHtml(narrative.rights)}
        </p>
        <p style="margin: 0 0 24px; color: #18181B; font-size: 14px; line-height: 1.6;">
          Click below to accept the invitation. You&rsquo;ll either be logged into your existing Taxottic account or walked through creating one in about 60 seconds.
        </p>
        <a href="${escapeAttr(args.inviteUrl)}" style="display: inline-block; padding: 12px 24px; background: ${escapeAttr(cta)}; color: #F5EDD6; text-decoration: none; border-radius: 999px; font-size: 14px;">Join ${escapeHtml(args.firmName)} →</a>
        <hr style="border: none; border-top: 1px solid #E5E5E5; margin: 32px 0 16px;" />
        <p style="margin: 0; color: #71717A; font-size: 11px; line-height: 1.6;">
          This invitation expires in 7 days. If you weren&rsquo;t expecting it, you can safely ignore the email.
        </p>
      </td></tr></table>
    </td></tr></table>
  </body></html>`;

  const text =
    `${args.recipientName ? `Hi ${args.recipientName.split(" ")[0]},` : "Hi,"}\n\n` +
    `${args.inviterName ? `${args.inviterName} at ${args.firmName}` : args.firmName} invited you to join the firm ${narrative.headline} on Taxottic${args.title ? ` (${args.title})` : ""}.\n\n` +
    `${narrative.rights}\n\n` +
    `Accept the invitation:\n${args.inviteUrl}\n\n` +
    `Expires in 7 days. If you weren't expecting this email, you can ignore it.`;

  return {
    subject,
    html,
    text,
    fromName: args.firmName,
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
