// Sends a beta / TestFlight invitation email via the Resend transport,
// rendering the shared beta-invite template. Best-effort: sendEmail never
// throws (see lib/email/transport.ts). Returns whether a real provider
// actually sent it, so callers can fall back to logging the link for a
// manual handoff (e.g. when RESEND_API_KEY isn't configured, provider is
// "noop"). Mirrors the render-then-sendEmail pattern used by the company /
// firm invite flows.

import { sendEmail } from "@/lib/email/transport";
import {
  renderBetaInviteEmail,
  type BetaInviteArgs,
} from "@/lib/email/templates/beta-invite";

export type SendBetaInviteArgs = BetaInviteArgs & {
  /** Recipient email address. */
  to: string;
  /** Optional Reply-To so tester replies land in the inviter's inbox. */
  replyTo?: string;
};

export type SendBetaInviteResult = {
  /** True only when a real provider (not the "noop" fallback) accepted it. */
  sent: boolean;
  provider: "resend" | "noop";
  reason?: string;
};

export async function sendBetaInvite(
  args: SendBetaInviteArgs,
): Promise<SendBetaInviteResult> {
  const { to, replyTo, ...templateArgs } = args;
  const rendered = renderBetaInviteEmail(templateArgs);

  const result = await sendEmail({
    to,
    replyTo,
    fromName: rendered.fromName,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tags: { kind: "beta-invite", platform: templateArgs.platform ?? "ios" },
  });

  const sent = result.ok && result.provider !== "noop";
  if (!sent) {
    console.error(
      `[beta-invite] email not sent to ${to} (provider=${result.provider}${result.reason ? `, reason=${result.reason}` : ""})`,
    );
  }
  return { sent, provider: result.provider, reason: result.reason };
}
