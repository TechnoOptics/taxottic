import {
  explainKind,
  summarize,
  type UndeliveredAlert,
} from "@/lib/mileage/undelivered-alerts";

/**
 * "A driver's tracker is broken and we could not tell them" email.
 *
 * This exists because push was the only delivery path and it failed
 * silently. A driver's tracker degraded on 2026-08-06, the detector
 * caught it immediately, and the notification could not be delivered
 * because that device had no registered push token. The alert sat in the
 * database for five days while the miles vanished.
 *
 * Email is the fallback precisely because it shares NO infrastructure
 * with push: no device token, no APNs credential, no app install, no
 * WebView. If push is the thing that is broken, a second push-based
 * warning is worthless.
 *
 * The tone is deliberately flat. This is an operational warning about
 * money quietly not being recorded, so it states what broke, for how
 * long, and the one thing to do about it. No urgency theatre.
 */

const TAXOTTIC_LOGO_URL = "https://taxottic.com/brand/full-logo.png";

export type TrackerDegradedArgs = {
  /** Manager's name, for the greeting. */
  recipientName?: string | null;
  /** Longest-running first, as findUndelivered already sorts them. */
  alerts: UndeliveredAlert[];
  /** Deep link to the admin mileage view. */
  mileageUrl: string;
};

export function renderTrackerDegradedEmail(args: TrackerDegradedArgs): {
  subject: string;
  html: string;
  text: string;
  fromName: string;
} {
  const navy = "#1d2843";
  const cream = "#F5EDD6";
  const inkSoft = "#3F3F46";

  const firstName = args.recipientName?.split(" ")[0];
  const greet = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";
  const subject = summarize(args.alerts);

  const ageOf = (a: UndeliveredAlert) => {
    const days = Math.floor(a.stalledHours / 24);
    if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
    const hours = Math.max(1, Math.round(a.stalledHours));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  };

  const rows = args.alerts
    .map((a) => {
      const name = escapeHtml(a.driverName ?? "Unnamed driver");
      const flag =
        a.severity === "critical"
          ? `<span style="color:${navy};font-weight:600;">${escapeHtml(ageOf(a))}</span>`
          : escapeHtml(ageOf(a));
      return `<tr>
  <td style="padding:10px 12px;border-bottom:1px solid #E4E4E7;">${name}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #E4E4E7;">${flag}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #E4E4E7;color:${inkSoft};">${escapeHtml(explainKind(a.kind))}</td>
</tr>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:${cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:28px 20px;">
    <img src="${TAXOTTIC_LOGO_URL}" alt="Taxottic" height="28" style="height:28px;margin-bottom:22px;" />
    <div style="background:#ffffff;border:1px solid #E4E4E7;border-radius:14px;padding:26px;">
      <p style="margin:0 0 14px;color:${navy};font-size:15px;">${greet}</p>
      <p style="margin:0 0 18px;color:${inkSoft};font-size:15px;line-height:1.55;">
        Mileage capture is not working properly for
        ${args.alerts.length === 1 ? "a driver" : `${args.alerts.length} drivers`}
        on your team. We could not reach
        ${args.alerts.length === 1 ? "them" : "them all"} in the app, so this is
        the fallback. Business miles driven during this period are most
        likely not being recorded, and mileage cannot be reconstructed
        after the fact.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;color:${navy};margin:0 0 20px;">
        <thead>
          <tr style="text-align:left;color:${inkSoft};font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">
            <th style="padding:0 12px 8px;">Driver</th>
            <th style="padding:0 12px 8px;">Not working for</th>
            <th style="padding:0 12px 8px;">What is happening</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <a href="${escapeAttr(args.mileageUrl)}"
         style="display:inline-block;background:${navy};color:${cream};text-decoration:none;padding:11px 20px;border-radius:9px;font-size:14px;font-weight:600;">
        Open mileage
      </a>
      <p style="margin:20px 0 0;color:${inkSoft};font-size:13px;line-height:1.55;">
        The usual fix is for the driver to open Taxottic and confirm
        Location is set to Always with Precise Location on. If it already
        is, reply to this email and we will look at the device record.
      </p>
    </div>
    <p style="margin:16px 0 0;color:${inkSoft};font-size:12px;">
      You are receiving this because you manage mileage for this company.
    </p>
  </div>
</body></html>`;

  const text = [
    greet,
    "",
    `Mileage capture is not working properly for ${
      args.alerts.length === 1 ? "a driver" : `${args.alerts.length} drivers`
    } on your team. We could not reach them in the app, so this is the fallback.`,
    "Business miles driven during this period are most likely not being recorded, and mileage cannot be reconstructed after the fact.",
    "",
    ...args.alerts.map(
      (a) =>
        `- ${a.driverName ?? "Unnamed driver"}: not working for ${ageOf(a)}. ${explainKind(a.kind)}`,
    ),
    "",
    `Open mileage: ${args.mileageUrl}`,
    "",
    "The usual fix is for the driver to open Taxottic and confirm Location is set to Always with Precise Location on.",
  ].join("\n");

  return { subject, html, text, fromName: "Taxottic" };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
