import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email/transport";
import { renderTrackerDegradedEmail } from "@/lib/email/templates/tracker-degraded";
import {
  EMAIL_EVERY_MS,
  findUndelivered,
  shouldEmailManager,
  type TrackerAlertRow,
} from "./undelivered-alerts";

/**
 * Email a company's managers about tracker episodes the driver was never
 * told about.
 *
 * The last resort, and the only channel in this system that shares no
 * dependency with push. A driver lost six days of mileage in August 2026
 * because the detector worked perfectly, the notification could not be
 * delivered (no registered device token), and the manager escalation
 * fell back to push as well, which is not a fallback at all.
 *
 * Deliberately conservative about what it sends:
 *   - Only episodes with `notified_at` NULL, which is the definition of
 *     "the driver does not know".
 *   - Once per driver episode per 24 hours, keyed on manager_emailed_at,
 *     because the flag that would otherwise gate it can never become
 *     true for a driver nobody can reach.
 *   - Never mails a manager about their own tracker; they get the
 *     in-app and push paths like any other driver.
 *
 * Failures here are swallowed and counted. A mail provider outage must
 * not take down the finalizer, whose primary job is turning points into
 * trips.
 */

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com";

export type EmailSweepResult = {
  companies: number;
  emailed: number;
  skippedThrottled: number;
  failed: number;
};

export async function emailUndeliveredAlerts(
  admin: SupabaseClient,
  nowMs: number,
): Promise<EmailSweepResult> {
  const result: EmailSweepResult = {
    companies: 0,
    emailed: 0,
    skippedThrottled: 0,
    failed: 0,
  };

  const { data: alerts, error } = await admin
    .from("mileage_tracker_alerts")
    .select(
      "driver_user_id, company_id, kind, stalled_since, notified_at, delivery_failed_at, escalated_at, manager_emailed_at",
    )
    .is("notified_at", null)
    .not("stalled_since", "is", null);

  // A missing column (42703) means the migration has not been applied.
  // Say so loudly rather than returning zeros, which would look exactly
  // like a healthy fleet. That confusion cost a full evening once.
  if (error) {
    console.error(
      `[tracker-email] query failed (${error.code}): ${error.message}`,
    );
    return result;
  }
  if (!alerts?.length) return result;

  // Names for the email body. One query, not one per driver.
  const driverIds = [...new Set(alerts.map((a) => a.driver_user_id as string))];
  const { data: people } = await admin
    .from("profiles")
    .select("id, full_name")
    .in("id", driverIds);
  const nameOf = new Map(
    (people ?? []).map((p) => [p.id as string, p.full_name as string | null]),
  );

  const byCompany = new Map<string, typeof alerts>();
  for (const a of alerts) {
    const key = a.company_id as string;
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key)!.push(a);
  }

  for (const [companyId, rows] of byCompany) {
    result.companies++;

    const undelivered = findUndelivered(
      rows.map(
        (r): TrackerAlertRow => ({
          driverUserId: r.driver_user_id as string,
          driverName: nameOf.get(r.driver_user_id as string) ?? null,
          companyId,
          kind: (r.kind as string) ?? "unknown",
          stalledSince: r.stalled_since as string | null,
          notifiedAt: r.notified_at as string | null,
          deliveryFailedAt: r.delivery_failed_at as string | null,
          escalatedAt: r.escalated_at as string | null,
        }),
      ),
      nowMs,
    );
    if (undelivered.length === 0) continue;

    // Throttle on the most recent email for ANY episode at this company,
    // so a company with several degraded drivers gets one message a day
    // rather than one per driver.
    const lastEmailedMs = rows
      .map((r) =>
        r.manager_emailed_at ? Date.parse(r.manager_emailed_at as string) : null,
      )
      .filter((n): n is number => n != null && Number.isFinite(n))
      .reduce<number | null>((a, b) => (a == null || b > a ? b : a), null);

    if (!shouldEmailManager({ undelivered, lastEmailedMs, nowMs })) {
      result.skippedThrottled++;
      continue;
    }

    const { data: mgrs } = await admin
      .from("company_members")
      .select("user_id, role")
      .eq("company_id", companyId)
      .in("role", ["manager", "lead"]);
    if (!mgrs?.length) continue;

    const affected = new Set(undelivered.map((u) => u.driverUserId));
    const managerIds = (mgrs as { user_id: string }[])
      .map((m) => m.user_id)
      // Do not mail someone purely about their own tracker; that path is
      // the driver-facing one and this email is a management view.
      .filter((id) => !(affected.has(id) && affected.size === 1));
    if (managerIds.length === 0) continue;

    const { data: recipients } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .in("id", managerIds);

    let anySent = false;
    for (const m of recipients ?? []) {
      const to = (m.email as string | null)?.trim();
      if (!to) continue;
      const mail = renderTrackerDegradedEmail({
        recipientName: m.full_name as string | null,
        alerts: undelivered,
        mileageUrl: `${SITE}/mileage`,
      });
      try {
        const sent = await sendEmail({
          to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          fromName: mail.fromName,
          tags: { kind: "tracker-degraded" },
        });
        if (sent.ok) {
          anySent = true;
          result.emailed++;
        } else {
          result.failed++;
          console.error(`[tracker-email] send refused: ${sent.reason}`);
        }
      } catch (e) {
        result.failed++;
        console.error(`[tracker-email] send threw: ${String(e)}`);
      }
    }

    // Stamp ONLY on a real send. Stamping regardless would silence the
    // next 24 hours on the strength of an email that never left, which
    // is the same class of bug as recording notified_at for a push that
    // failed: it converts a delivery failure into permanent silence.
    if (anySent) {
      const iso = new Date(nowMs).toISOString();
      await admin
        .from("mileage_tracker_alerts")
        .update({ manager_emailed_at: iso })
        .eq("company_id", companyId)
        .is("notified_at", null)
        .in("driver_user_id", [...affected]);
    }
  }

  return result;
}

export { EMAIL_EVERY_MS };
