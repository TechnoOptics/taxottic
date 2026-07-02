// Email body for company team-member invitations (the consumer app's
// "Add an employee" flow on /c/[publicId]/manage). Distinct from the
// firm-member-invite template: this is "join this small business's
// Taxottic team as an employee," not "join our accounting firm."

export type CompanyMemberInviteArgs = {
  companyName: string;
  inviterName?: string | null;
  recipientName?: string | null;
  role: "member" | "manager";
  title?: string | null;
  personalMessage?: string | null;
  inviteUrl: string;
};

const ROLE_NARRATIVE: Record<
  CompanyMemberInviteArgs["role"],
  { headline: string; rights: string }
> = {
  member: {
    headline: "as a team member",
    rights:
      "You'll be able to log your own expenses, track business mileage, and chat with the team on Taxottic.",
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
  const cta = "#1d2843";
  const greet = args.recipientName
    ? `Hi ${escapeHtml(args.recipientName.split(" ")[0])},`
    : "Hi,";
  const narrative = ROLE_NARRATIVE[args.role];
  const inviterLine = args.inviterName
    ? `${escapeHtml(args.inviterName)} at ${escapeHtml(args.companyName)}`
    : escapeHtml(args.companyName);
  const subject = `${args.companyName} added you on Taxottic`;

  const messageBlock = args.personalMessage
    ? `<p style="margin: 0 0 16px; color: #18181B; font-size: 14px; line-height: 1.6; padding: 12px 16px; background: #F5EDD6; border-radius: 8px;">
        ${escapeHtml(args.personalMessage)}
      </p>`
    : "";

  const html = `<!doctype html><html><body style="font-family: -apple-system, sans-serif; background: #F5EDD6; margin: 0; padding: 32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" style="background: #FFFFFF; border-radius: 16px; max-width: 560px;"><tr><td style="padding: 32px;">
        <div style="font-family: Georgia, serif; font-size: 18px; font-weight: 600; color: #1d2843; margin-bottom: 24px;">${escapeHtml(args.companyName)}</div>
        <h1 style="font-family: Georgia, serif; font-size: 22px; color: #1d2843; margin: 0 0 16px; line-height: 1.3;">${greet}</h1>
        <p style="margin: 0 0 16px; color: #18181B; font-size: 14px; line-height: 1.6;">
          ${inviterLine} added you to their team ${escapeHtml(narrative.headline)} on Taxottic${args.title ? ` (${escapeHtml(args.title)})` : ""}.
        </p>
        <p style="margin: 0 0 16px; color: #18181B; font-size: 14px; line-height: 1.6;">
          ${escapeHtml(narrative.rights)}
        </p>
        ${messageBlock}
        <p style="margin: 0 0 24px; color: #18181B; font-size: 14px; line-height: 1.6;">
          Click below to accept. You&rsquo;ll either be logged into your existing Taxottic account or walked through creating one in about 60 seconds.
        </p>
        <a href="${escapeAttr(args.inviteUrl)}" style="display: inline-block; padding: 12px 24px; background: ${cta}; color: #F5EDD6; text-decoration: none; border-radius: 999px; font-size: 14px;">Join ${escapeHtml(args.companyName)} →</a>
        <hr style="border: none; border-top: 1px solid #E5E5E5; margin: 32px 0 16px;" />
        <p style="margin: 0; color: #71717A; font-size: 11px; line-height: 1.6;">
          This invitation expires in 14 days. If you weren&rsquo;t expecting it, you can safely ignore the email.
        </p>
      </td></tr></table>
    </td></tr></table>
  </body></html>`;

  const text =
    `${args.recipientName ? `Hi ${args.recipientName.split(" ")[0]},` : "Hi,"}\n\n` +
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
