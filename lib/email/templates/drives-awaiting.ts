import {
  routeLabel,
  summarize,
  type DriverReminder,
} from "@/lib/mileage/unconfirmed-drives";

/**
 * "You have drives waiting to be confirmed" email.
 *
 * Sent to the DRIVER, not the manager. This is a small favour being
 * asked of the person who did the driving, so the tone is a request
 * rather than an alert, and the deadline framing is the real one: an
 * unconfirmed drive still counts, it just is not finished.
 *
 * Every drive is listed with its date, route and mileage, because a
 * driver cannot answer "was this business?" about a row they cannot
 * recognise. Routes only exist for drives recorded from 2026-08-15,
 * when trip endpoints started being written at all, so routeLabel
 * returns an empty string for older ones rather than a placeholder.
 */

const TAXOTTIC_LOGO_URL = "https://taxottic.com/brand/full-logo.png";

export type DrivesAwaitingArgs = {
  reminder: DriverReminder;
  /** Deep link to the classify queue. */
  classifyUrl: string;
};

export function renderDrivesAwaitingEmail(args: DrivesAwaitingArgs): {
  subject: string;
  html: string;
  text: string;
  fromName: string;
} {
  const { reminder: r } = args;
  const navy = "#1d2843";
  const cream = "#F5EDD6";
  const inkSoft = "#3F3F46";

  const firstName = r.driverName?.split(" ")[0];
  const greet = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";
  const subject = summarize(r);

  const dateOf = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  const rows = r.drives
    .map((d) => {
      const route = routeLabel(d);
      return `<tr>
  <td style="padding:9px 12px;border-bottom:1px solid #E4E4E7;white-space:nowrap;">${escapeHtml(dateOf(d.startedAt))}</td>
  <td style="padding:9px 12px;border-bottom:1px solid #E4E4E7;color:${inkSoft};">${route ? escapeHtml(route) : "&mdash;"}</td>
  <td style="padding:9px 12px;border-bottom:1px solid #E4E4E7;text-align:right;white-space:nowrap;">${d.distanceMiles.toFixed(1)} mi</td>
</tr>`;
    })
    .join("\n");

  const stale = r.hasStale
    ? `<p style="margin:0 0 18px;color:${inkSoft};font-size:14px;line-height:1.55;">
         The oldest has been waiting ${r.oldestDays} days. Drives are easiest
         to place while you still remember them, which is the only reason
         this is worth two minutes now rather than in April.
       </p>`
    : "";

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:${cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:28px 20px;">
    <img src="${TAXOTTIC_LOGO_URL}" alt="Taxottic" height="28" style="height:28px;margin-bottom:22px;" />
    <div style="background:#ffffff;border:1px solid #E4E4E7;border-radius:14px;padding:26px;">
      <p style="margin:0 0 14px;color:${navy};font-size:15px;">${greet}</p>
      <p style="margin:0 0 18px;color:${inkSoft};font-size:15px;line-height:1.55;">
        ${r.drives.length === 1 ? "One drive is" : `${r.drives.length} drives are`}
        waiting for you to say whether ${r.drives.length === 1 ? "it was" : "they were"}
        business or personal, ${r.totalMiles} miles in total. They are already
        recorded, so nothing is lost. They just are not counted toward your
        deduction until they are confirmed.
      </p>
      ${stale}
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;color:${navy};margin:0 0 20px;">
        <thead>
          <tr style="text-align:left;color:${inkSoft};font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">
            <th style="padding:0 12px 8px;">Date</th>
            <th style="padding:0 12px 8px;">Route</th>
            <th style="padding:0 12px 8px;text-align:right;">Distance</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <a href="${escapeAttr(args.classifyUrl)}"
         style="display:inline-block;background:${navy};color:${cream};text-decoration:none;padding:11px 20px;border-radius:9px;font-size:14px;font-weight:600;">
        Confirm these drives
      </a>
    </div>
    <p style="margin:16px 0 0;color:${inkSoft};font-size:12px;">
      Sent because you have drives awaiting confirmation. You will get at
      most one of these every few days.
    </p>
  </div>
</body></html>`;

  const text = [
    greet,
    "",
    `${r.drives.length === 1 ? "One drive is" : `${r.drives.length} drives are`} waiting for you to say whether ${r.drives.length === 1 ? "it was" : "they were"} business or personal, ${r.totalMiles} miles in total.`,
    "They are already recorded, so nothing is lost. They just are not counted toward your deduction until they are confirmed.",
    ...(r.hasStale
      ? ["", `The oldest has been waiting ${r.oldestDays} days.`]
      : []),
    "",
    ...r.drives.map((d) => {
      const route = routeLabel(d);
      return `- ${dateOf(d.startedAt)}${route ? `, ${route}` : ""}, ${d.distanceMiles.toFixed(1)} mi`;
    }),
    "",
    `Confirm these drives: ${args.classifyUrl}`,
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
