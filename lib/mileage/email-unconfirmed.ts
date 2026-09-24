import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendEmail,
  type SendEmailArgs,
  type SendEmailResult,
} from "@/lib/email/transport";
import { renderDrivesAwaitingEmail } from "@/lib/email/templates/drives-awaiting";
import { buildReminders, type PendingDrive } from "./unconfirmed-drives";

/**
 * Email drivers about drives still waiting on a business/personal call.
 *
 * Ten were pending in production when this shipped, the oldest for
 * seventeen days, and neither driver had ever been told: the only
 * channel was push, and there are zero iOS push tokens. This sweep uses
 * email because email shares no dependency with push, so it cannot fail
 * for the same reason at the same time.
 *
 * It is invoked from the mileage-finalize cron every ten minutes,
 * immediately after the finalize loop that materialises stranded
 * drives, so a drive becomes a row and gets reported in the same tick.
 * The cadence rules live in ./unconfirmed-drives.ts; read the header
 * there before changing the schedule, it records why the first
 * notification used to arrive up to 43.7 hours after a drive ended.
 *
 * Failures are counted and swallowed. This runs inside the mileage
 * finalizer, whose actual job is turning points into trips, and a mail
 * provider outage must not stop that.
 */

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com";

export type ReminderSweepResult = {
  driversWithPending: number;
  emailed: number;
  skippedThrottled: number;
  failed: number;
  /**
   * Sends the transport acknowledged without a provider behind it.
   *
   * sendEmail() returns `{ ok: true, provider: "noop" }` when
   * RESEND_API_KEY is unset. Reading only `ok` counts that as a
   * delivered reminder and stamps confirmation_reminded_at, which
   * silences the driver on the strength of a message that never left,
   * and makes a stamped row stop being evidence of a real dispatch.
   * That is the same bug as recording notified_at for a push that
   * failed, which is the bug this whole module was written to replace.
   *
   * Non-zero here in production means RESEND_API_KEY is missing.
   */
  noopSkipped: number;
};

/** Injected so the no-op and refusal branches are testable without env. */
export type EmailSender = (args: SendEmailArgs) => Promise<SendEmailResult>;

export async function emailUnconfirmedDrives(
  admin: SupabaseClient,
  nowMs: number,
  send: EmailSender = sendEmail,
): Promise<ReminderSweepResult> {
  const result: ReminderSweepResult = {
    driversWithPending: 0,
    emailed: 0,
    skippedThrottled: 0,
    failed: 0,
    noopSkipped: 0,
  };

  // Row shape declared locally rather than inferred. The generated
  // Supabase types do not know confirmation_reminded_at until the
  // migration is applied and types are regenerated, and the two
  // embedded places widen the inferred type to an error union. This
  // says what the query actually returns.
  type TripRow = {
    id: string;
    driver_user_id: string;
    started_at: string;
    ended_at: string | null;
    distance_miles: number | null;
    confirmation_reminded_at: string | null;
    start_place: { label: string | null } | { label: string | null }[] | null;
    end_place: { label: string | null } | { label: string | null }[] | null;
  };

  const { data: tripsRaw, error } = await admin
    .from("mileage_trips")
    .select(
      "id, driver_user_id, started_at, ended_at, distance_miles, confirmation_reminded_at, " +
        "start_place:mileage_places!mileage_trips_start_place_id_fkey(label), " +
        "end_place:mileage_places!mileage_trips_end_place_id_fkey(label)",
    )
    .eq("needs_confirmation", true);

  if (error) {
    // 42703 means the migration has not been applied. Say so loudly:
    // returning zeros here looks identical to a healthy fleet, and that
    // exact ambiguity has cost this project an evening before.
    console.error(
      `[drive-reminder] query failed (${error.code}): ${error.message}`,
    );
    return result;
  }
  const trips = (tripsRaw ?? []) as unknown as TripRow[];
  if (!trips.length) return result;

  const driverIds = [...new Set(trips.map((t) => t.driver_user_id))];
  const { data: people } = await admin
    .from("profiles")
    .select("id, full_name, email")
    .in("id", driverIds);
  const person = new Map(
    (people ?? []).map((p) => [
      p.id as string,
      {
        name: (p.full_name as string | null) ?? null,
        email: (p.email as string | null) ?? null,
      },
    ]),
  );

  const label = (v: unknown): string | null => {
    // PostgREST returns an embedded row as an object, or an array when
    // it cannot prove the relationship is to-one. Handle both rather
    // than trusting one shape.
    const row = Array.isArray(v) ? v[0] : v;
    const l = (row as { label?: string } | null)?.label;
    return typeof l === "string" && l.trim() ? l : null;
  };

  const pending: PendingDrive[] = trips.map((t) => ({
    tripId: t.id,
    driverUserId: t.driver_user_id,
    driverName: person.get(t.driver_user_id)?.name ?? null,
    driverEmail: person.get(t.driver_user_id)?.email ?? null,
    startedAt: t.started_at,
    // The settle window is measured from the END of the drive. ended_at
    // is NOT NULL on all 232 production rows, but a null here would
    // silently make every drive un-ripe, so fall back to the start
    // rather than dropping the driver out of the sweep entirely.
    endedAt: t.ended_at ?? t.started_at,
    distanceMiles: Number(t.distance_miles ?? 0),
    startPlace: label(t.start_place),
    endPlace: label(t.end_place),
    lastRemindedAt: t.confirmation_reminded_at ?? null,
  }));

  result.driversWithPending = new Set(pending.map((p) => p.driverUserId)).size;

  const reminders = buildReminders(pending, nowMs);
  // Everyone with pending drives who did NOT get a reminder was either
  // throttled or unreachable. Counting it keeps "quiet because it is
  // working" distinguishable from "quiet because it is broken".
  result.skippedThrottled = Math.max(
    0,
    result.driversWithPending - reminders.length,
  );

  for (const r of reminders) {
    const mail = renderDrivesAwaitingEmail({
      reminder: r,
      classifyUrl: `${SITE}/mileage/classify`,
    });
    try {
      const sent = await send({
        to: r.driverEmail,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        fromName: mail.fromName,
        tags: { kind: "drives-awaiting" },
      });
      if (!sent.ok) {
        result.failed++;
        console.error(`[drive-reminder] send refused: ${sent.reason}`);
        continue;
      }
      // `ok` alone is not dispatch. The no-provider path returns ok
      // with provider "noop" so callers do not retry-storm; treating it
      // as a send would stamp the throttle for a message that never
      // left and destroy the one piece of evidence we have that these
      // reminders are real. See ReminderSweepResult.noopSkipped.
      if (sent.provider !== "resend") {
        result.noopSkipped++;
        console.error(
          `[drive-reminder] not dispatched (provider=${sent.provider}); leaving ${r.drives.length} drive(s) unstamped for ${r.driverUserId}`,
        );
        continue;
      }
      result.emailed++;

      // Stamp ONLY the drives named in the email, and only after a real
      // send. Stamping regardless would silence the next three days on
      // the strength of a message that never left, which is the same
      // bug as recording notified_at for a push that failed.
      await admin
        .from("mileage_trips")
        .update({ confirmation_reminded_at: new Date(nowMs).toISOString() })
        .in(
          "id",
          r.drives.map((d) => d.tripId),
        );
    } catch (e) {
      result.failed++;
      console.error(`[drive-reminder] send threw: ${String(e)}`);
    }
  }

  return result;
}
