"use server";

import { requireSuperAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { sendBetaInvite } from "@/lib/email/send-beta-invite";

export type BetaInviteState = { ok: boolean; message: string } | null;

const PLATFORMS = ["ios", "android", "both"] as const;
type Platform = (typeof PLATFORMS)[number];

/**
 * Super-admin action to fire off a beta / TestFlight invitation email. Used
 * from /admin/beta-invite. Renders and sends the shared beta-invite template
 * via Resend, records an admin_actions audit row, and returns a state object
 * for the form's useActionState. Best-effort: if no email provider is
 * configured it reports that so the operator can hand the link over manually.
 */
export async function sendBetaInviteAction(
  _prev: BetaInviteState,
  formData: FormData,
): Promise<BetaInviteState> {
  const { user: adminUser } = await requireSuperAdmin();

  const to = String(formData.get("to") ?? "").trim();
  const inviteUrl = String(formData.get("invite_url") ?? "").trim();
  const recipientName = String(formData.get("recipient_name") ?? "").trim() || null;
  const inviterName = String(formData.get("inviter_name") ?? "").trim() || null;
  const personalMessage =
    String(formData.get("personal_message") ?? "").trim() || null;

  const platformRaw = String(formData.get("platform") ?? "ios");
  const platform: Platform = (PLATFORMS as readonly string[]).includes(
    platformRaw,
  )
    ? (platformRaw as Platform)
    : "ios";

  const focusAreas = String(formData.get("focus_areas") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  // Validate before we touch the transport.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { ok: false, message: "Enter a valid recipient email address." };
  }
  if (!/^https?:\/\/\S+$/i.test(inviteUrl)) {
    return {
      ok: false,
      message: "Enter the TestFlight / beta link (it must start with http).",
    };
  }

  const result = await sendBetaInvite({
    to,
    recipientName,
    inviterName,
    platform,
    inviteUrl,
    personalMessage,
    focusAreas,
  });

  // Audit trail (mirrors app/admin/actions.ts). No secrets in metadata.
  const admin = createServiceClient();
  await admin.from("admin_actions").insert({
    admin_user_id: adminUser.id,
    target_user_id: null,
    action: "send_beta_invite",
    metadata: { to, platform, provider: result.provider, sent: result.sent },
  });

  if (!result.sent) {
    return {
      ok: false,
      message:
        result.provider === "noop"
          ? "No email provider is configured (RESEND_API_KEY is unset), so nothing was sent. The message is ready; send the link manually."
          : `The provider did not accept the send${result.reason ? ` (${result.reason})` : ""}. Try again or send the link manually.`,
    };
  }

  return { ok: true, message: `Beta invite sent to ${to}.` };
}
