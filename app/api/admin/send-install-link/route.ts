import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/transport";
import { renderAppLiveEmail } from "@/lib/email/templates/app-live";

export const runtime = "nodejs";

/**
 * Send the public install link (app/get) to named recipients.
 *
 * Why an endpoint: RESEND_API_KEY only exists in the production env, so
 * mail cannot be sent from a laptop or from CI. This is the operator
 * path for "point these people at the app" without inventing a fake
 * invitation record (they're often already members) and without the
 * beta-invite template, whose copy promises a build "before it ships".
 *
 * Auth: Bearer $CRON_SECRET, the same shared secret the cron routes use.
 * There is no session path on purpose: this sends outbound mail, so it
 * stays operator-only rather than reachable by any signed-in user.
 */
const INSTALL_URL = "https://taxottic.com/get";
const MAX_RECIPIENTS = 25;

type Recipient = { email: string; name?: string | null };

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    recipients?: Recipient[];
    senderName?: string | null;
    personalMessage?: string | null;
    highlights?: string[];
    dryRun?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const recipients = (body.recipients ?? []).filter(
    (r): r is Recipient =>
      !!r && typeof r.email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email),
  );
  if (recipients.length === 0) {
    return NextResponse.json({ error: "no_valid_recipients" }, { status: 400 });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: "too_many_recipients", max: MAX_RECIPIENTS },
      { status: 400 },
    );
  }

  // dryRun renders without sending, so the exact copy can be reviewed
  // before anything reaches a real inbox.
  const results: Array<{ email: string; ok: boolean; reason?: string }> = [];
  for (const r of recipients) {
    const mail = renderAppLiveEmail({
      recipientName: r.name ?? null,
      senderName: body.senderName ?? null,
      installUrl: INSTALL_URL,
      personalMessage: body.personalMessage ?? null,
      highlights: body.highlights ?? [],
    });
    if (body.dryRun) {
      results.push({ email: r.email, ok: true, reason: "dry_run" });
      continue;
    }
    try {
      const sent = await sendEmail({
        to: r.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        fromName: mail.fromName,
      });
      results.push({
        email: r.email,
        ok: sent.ok,
        reason: sent.ok ? undefined : (sent.reason ?? "send_failed"),
      });
    } catch (err) {
      results.push({
        email: r.email,
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const sample = renderAppLiveEmail({
    recipientName: recipients[0].name ?? null,
    senderName: body.senderName ?? null,
    installUrl: INSTALL_URL,
    personalMessage: body.personalMessage ?? null,
    highlights: body.highlights ?? [],
  });

  return NextResponse.json({
    ok: results.every((r) => r.ok),
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    dryRun: body.dryRun === true,
    subject: sample.subject,
    preview: body.dryRun ? sample.text : undefined,
  });
}
