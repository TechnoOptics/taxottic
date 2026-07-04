import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/transport";
import { DIGEST_INTERESTING_KINDS } from "@/lib/firm/notifications";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Hourly cron, sends daily / weekly digest emails to firm
 * members whose preferred send hour matches the current UTC hour.
 *
 * Why hourly: the prefs let users pick `digest_hour_utc` from 0-23.
 * If we run once a day at UTC 13, half the users would get their
 * "morning" email at midnight local. Running hourly lets each user
 * receive the digest at their picked UTC hour without us standing
 * up per-user cron jobs.
 *
 * Idempotency: each user-firm pair has a `last_digest_sent_at`
 * cursor on `firm_activity_reads`. We only send if the cursor is
 * older than the cadence window (24h for daily, 7d for weekly).
 * Retries are safe.
 *
 * Auth: same envelope as plaid-sync, accepts the Vercel cron
 * header OR an Authorization: Bearer $CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const isCron = req.headers.get("x-vercel-cron") === "1";
  const auth = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const authorized =
    isCron ||
    (cronSecret &&
      auth.startsWith("Bearer ") &&
      auth.slice("Bearer ".length) === cronSecret);
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const nowUtcHour = new Date().getUTCHours();
  const nowIso = new Date().toISOString();

  // 1. Find every prefs row whose send-hour matches now AND whose
  //    cadence is not "off". Read tier returns the user + firm + the
  //    cursor row in one query.
  const { data: candidates } = await admin
    .from("firm_notification_preferences")
    .select(
      "user_id, firm_id, digest_cadence, digest_hour_utc, excluded_kinds, profiles!inner(id, email, full_name), firms!inner(id, name, slug, status)",
    )
    .eq("digest_hour_utc", nowUtcHour)
    .neq("digest_cadence", "off");

  type Row = {
    user_id: string;
    firm_id: string;
    digest_cadence: "daily" | "weekly";
    digest_hour_utc: number;
    excluded_kinds: string[];
    profiles: { id: string; email: string; full_name: string | null };
    firms: {
      id: string;
      name: string;
      slug: string | null;
      status: "pending" | "active" | "suspended";
    };
  };
  const rows = (candidates ?? []) as unknown as Row[];

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      if (row.firms.status !== "active") {
        skipped += 1;
        continue;
      }

      // Read the cursor row so we know the digest window.
      const { data: cursorRow } = await admin
        .from("firm_activity_reads")
        .select("last_read_at, last_digest_sent_at")
        .eq("user_id", row.user_id)
        .eq("firm_id", row.firm_id)
        .maybeSingle();

      const windowDays = row.digest_cadence === "weekly" ? 7 : 1;
      const windowMs = windowDays * 86_400_000;
      const lastSentAt = cursorRow?.last_digest_sent_at
        ? new Date(cursorRow.last_digest_sent_at).getTime()
        : 0;
      if (Date.now() - lastSentAt < windowMs - 3_600_000) {
        // Already sent within the cadence window (with 1h slack).
        skipped += 1;
        continue;
      }

      // Find activity since the lookback window.
      const since = new Date(Date.now() - windowMs).toISOString();
      const excluded = new Set<string>(row.excluded_kinds ?? []);
      const includedKinds = DIGEST_INTERESTING_KINDS.filter(
        (k) => !excluded.has(k),
      );
      if (includedKinds.length === 0) {
        skipped += 1;
        continue;
      }

      const { data: activity } = await admin
        .from("firm_activity_log")
        .select("id, kind, summary, created_at")
        .eq("firm_id", row.firm_id)
        .gte("created_at", since)
        .in("kind", includedKinds)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!activity || activity.length === 0) {
        // Nothing to report, still bump the cursor so we don't
        // re-evaluate this user for another window.
        await admin
          .from("firm_activity_reads")
          .upsert(
            {
              user_id: row.user_id,
              firm_id: row.firm_id,
              last_read_at: cursorRow?.last_read_at ?? nowIso,
              last_digest_sent_at: nowIso,
            },
            { onConflict: "user_id,firm_id" },
          );
        skipped += 1;
        continue;
      }

      // Render the email body. Plain HTML, no email-framework dep.
      const firm = row.firms;
      const portalUrl = firm.slug
        ? `https://${firm.slug}.taxottic.com/firm/inbox`
        : `https://taxottic.com/firm/inbox`;
      const list = activity
        .map(
          (a) =>
            `<li style="margin-bottom: 8px; color: #18181B; font-size: 14px; line-height: 1.5;">${escapeHtml(
              a.summary ?? a.kind,
            )} <span style="color: #71717A;">- ${formatLocal(a.created_at)}</span></li>`,
        )
        .join("");
      const subject =
        row.digest_cadence === "weekly"
          ? `${firm.name}, your weekly summary (${activity.length} updates)`
          : `${firm.name}, today's summary (${activity.length} updates)`;
      const html = `<!doctype html><html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #F5EDD6; margin: 0; padding: 32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
          <table role="presentation" width="560" style="background-color: #FFFFFF; border-radius: 16px; max-width: 560px;"><tr><td style="padding: 32px;">
            <div style="font-family: Georgia, serif; font-size: 18px; font-weight: 600; color: #1d2843; margin-bottom: 24px;">${escapeHtml(firm.name)}</div>
            <h1 style="font-family: Georgia, serif; font-size: 22px; color: #1d2843; margin: 0 0 16px;">${row.digest_cadence === "weekly" ? "This week on " : "Today on "}${escapeHtml(firm.name)}</h1>
            <p style="margin: 0 0 24px; color: #18181B; font-size: 14px; line-height: 1.6;">
              ${activity.length} event${activity.length === 1 ? "" : "s"} since your last digest.
            </p>
            <ul style="margin: 0 0 24px; padding: 0 0 0 16px;">${list}</ul>
            <a href="${portalUrl}" style="display: inline-block; padding: 12px 24px; background-color: #1d2843; color: #F5EDD6; text-decoration: none; border-radius: 999px; font-size: 14px;">Open the inbox →</a>
            <hr style="border: none; border-top: 1px solid #E5E5E5; margin: 32px 0 24px;" />
            <p style="margin: 0; color: #71717A; font-size: 11px; line-height: 1.6;">
              You're receiving this because your ${row.digest_cadence} digest is enabled. <a href="${portalUrl.replace("/inbox", "/settings/notifications")}" style="color: #71717A;">Change cadence or turn off</a>.
            </p>
          </td></tr></table>
        </td></tr></table>
      </body></html>`;
      const text =
        `${firm.name}\n\n${activity.length} event${activity.length === 1 ? "" : "s"} since your last digest:\n\n` +
        activity
          .map((a) => `• ${a.summary ?? a.kind}, ${formatLocal(a.created_at)}`)
          .join("\n") +
        `\n\nOpen the inbox: ${portalUrl}\nChange cadence: ${portalUrl.replace("/inbox", "/settings/notifications")}\n`;

      const result = await sendEmail({
        to: row.profiles.email,
        fromName: firm.name,
        subject,
        html,
        text,
        tags: {
          kind: "firm-digest",
          cadence: row.digest_cadence,
          firm_slug: firm.slug ?? "no-slug",
        },
      });
      if (result.ok) {
        sent += 1;
        await admin
          .from("firm_activity_reads")
          .upsert(
            {
              user_id: row.user_id,
              firm_id: row.firm_id,
              last_read_at: cursorRow?.last_read_at ?? nowIso,
              last_digest_sent_at: nowIso,
            },
            { onConflict: "user_id,firm_id" },
          );
      } else {
        failed += 1;
         
        console.error(
          `[firm-digest] send failed for ${row.profiles.email}: ${result.reason}`,
        );
      }
    } catch (err) {
      failed += 1;
       
      console.error("[firm-digest] row error:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: rows.length,
    sent,
    skipped,
    failed,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}

function formatLocal(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
