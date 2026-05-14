import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { computeNextIssueAt } from "@/lib/firm/invoice-templates/schedule";
import { logFirmActivity } from "@/lib/firm/activity";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Hourly cron — mints draft `firm_invoices` rows from active
 * `firm_invoice_templates` whose `next_issue_at` has elapsed.
 *
 * Why hourly:
 *   We want monthly templates that anchor to the 1st of the month
 *   to issue at-or-just-after midnight UTC on day 1. An hourly
 *   cadence gives us a window of 0-59 minutes of latency, which is
 *   fine for accounting work.
 *
 * Idempotency:
 *   We advance `next_issue_at` in the SAME UPDATE that creates the
 *   invoice. Vercel Cron retries a failed run, but our WHERE clause
 *   filters by `next_issue_at <= now()` so a retry that fires a
 *   second too late won't double-mint. The cron is not transactional
 *   across rows — if we crash mid-batch, the rows we already
 *   advanced stay advanced and the rest get picked up next hour.
 *
 * Output:
 *   - status: "ok"
 *   - processed: number of templates we walked
 *   - minted: number of new invoices created
 *
 * Auth: same envelope as the other crons.
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
  const nowIso = new Date().toISOString();

  const { data: templates } = await admin
    .from("firm_invoice_templates")
    .select(
      "id, firm_id, engagement_id, company_id, name, line_items, cadence, issue_day_of_month, recipient_email, recipient_name, notes, next_issue_at",
    )
    .eq("active", true)
    .lte("next_issue_at", nowIso)
    .limit(500);
  const rows = templates ?? [];

  let minted = 0;
  for (const t of rows) {
    try {
      const lineItems = t.line_items as Array<{
        description: string;
        quantity: number;
        unit_amount_cents: number;
      }>;
      const subtotal = lineItems.reduce(
        (a, li) => a + li.quantity * li.unit_amount_cents,
        0,
      );
      const platformFeeCents = Math.round((subtotal * 300) / 10000); // 3 %
      const invoiceNumber = `REC-${new Date().getUTCFullYear()}-${Math.floor(
        Math.random() * 9000 + 1000,
      )}`;

      const { data: inv, error } = await admin
        .from("firm_invoices")
        .insert({
          firm_id: t.firm_id,
          engagement_id: t.engagement_id,
          company_id: t.company_id,
          invoice_number: invoiceNumber,
          line_items: lineItems,
          subtotal_cents: subtotal,
          tax_cents: 0,
          total_cents: subtotal,
          currency: "usd",
          platform_fee_bps: 300,
          platform_fee_cents: platformFeeCents,
          recipient_email: t.recipient_email,
          recipient_name: t.recipient_name,
          status: "draft",
          notes: t.notes
            ? `${t.notes}\n\n(Auto-generated from template "${t.name}".)`
            : `Auto-generated from template "${t.name}".`,
        })
        .select("id, invoice_number")
        .single();
      if (error || !inv) {
        console.error(
          `[firm-invoice-issue] template ${t.id} insert failed:`,
          error?.message,
        );
        continue;
      }

      const next = computeNextIssueAt({
        cadence: t.cadence as "monthly" | "quarterly" | "annual",
        issueDayOfMonth: t.issue_day_of_month,
        reference: new Date(),
      });
      await admin
        .from("firm_invoice_templates")
        .update({
          last_issued_at: nowIso,
          next_issue_at: next.toISOString(),
        })
        .eq("id", t.id);

      await logFirmActivity({
        client: admin,
        firmId: t.firm_id,
        companyId: t.company_id,
        engagementId: t.engagement_id,
        kind: "firm.invoice_sent",
        summary: `Auto-drafted ${invoiceNumber} from "${t.name}".`,
        payload: {
          invoice_id: inv.id,
          template_id: t.id,
          subtotal_cents: subtotal,
        },
      });

      minted++;
    } catch (err) {
      console.error(
        `[firm-invoice-issue] template ${t.id} threw:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return NextResponse.json({
    status: "ok",
    processed: rows.length,
    minted,
  });
}
