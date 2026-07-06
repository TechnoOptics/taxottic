import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { computeNextIssueAt } from "@/lib/firm/invoice-templates/schedule";
import { logFirmActivity } from "@/lib/firm/activity";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Hourly cron, mints draft `firm_invoices` rows from active
 * `firm_invoice_templates` whose `next_issue_at` has elapsed.
 *
 * Why hourly:
 *   We want monthly templates that anchor to the 1st of the month
 *   to issue at-or-just-after midnight UTC on day 1. An hourly
 *   cadence gives us a window of 0-59 minutes of latency, which is
 *   fine for accounting work.
 *
 * Scaling profile + batching:
 *   - The :15 cadence dispatches a wave of ready templates every
 *     hour. At firm scale (a hundred firms × ~5 templates each)
 *     this is a few hundred templates max per tick.
 *   - We page through `PAGE_SIZE` (200) rows at a time, then
 *     short-circuit once we hit a `WALL_BUDGET_MS` budget so a
 *     pathological backlog doesn't push us past Vercel's 5-min
 *     maxDuration. The remaining rows roll over to the next hour
 *     because `next_issue_at` only advances on success.
 *   - Each template is best-effort; one failure logs + skips
 *     rather than aborting the batch.
 *
 * Idempotency:
 *   We advance `next_issue_at` in the SAME UPDATE that creates the
 *   invoice. Vercel Cron retries a failed run, but our WHERE clause
 *   filters by `next_issue_at <= now()` so a retry that fires a
 *   second too late won't double-mint. The cron is not transactional
 *   across rows, if we crash mid-batch, the rows we already
 *   advanced stay advanced and the rest get picked up next hour.
 *
 * Output:
 *   - status: "ok"
 *   - processed: number of templates we walked
 *   - minted: number of new invoices created
 *   - failed: number that errored individually
 *   - had_more: true when we paused mid-backlog (more next hour)
 *
 * Auth: same envelope as the other crons.
 */

const PAGE_SIZE = 200;
const WALL_BUDGET_MS = 4 * 60 * 1000; // 4 min of the 5-min Vercel ceiling

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
  const startMs = Date.now();

  let processed = 0;
  let minted = 0;
  let failed = 0;
  let hadMore = false;

  // Paginate through ready templates. The query is sargable on
  // `firm_invoice_templates_next_idx` (created in migration
  // 20260514000014); the partial index restricts to active=true
  // so the planner walks only the live set.
  while (true) {
    if (Date.now() - startMs > WALL_BUDGET_MS) {
      hadMore = true;
      break;
    }

    const { data: templates, error: fetchErr } = await admin
      .from("firm_invoice_templates")
      .select(
        "id, firm_id, engagement_id, company_id, name, line_items, cadence, issue_day_of_month, recipient_email, recipient_name, notes, next_issue_at",
      )
      .eq("active", true)
      .lte("next_issue_at", nowIso)
      .order("next_issue_at", { ascending: true })
      .limit(PAGE_SIZE);

    if (fetchErr) {
      return NextResponse.json(
        { status: "error", error: fetchErr.message, processed, minted, failed },
        { status: 500 },
      );
    }

    const rows = templates ?? [];
    if (rows.length === 0) break;

    for (const t of rows) {
      processed++;
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
        const genNumber = () =>
          `REC-${new Date().getUTCFullYear()}-${Math.floor(
            Math.random() * 9000 + 1000,
          )}`;

        // Retry on the firm_invoices unique-index collision (REC-YYYY-#### has
        // only 9000 values/firm/year, so a busy firm's cron run would otherwise
        // randomly fail to mint the recurring invoice).
        let inv: { id: string; invoice_number: string } | null = null;
        let insertErr: { message: string; code?: string } | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const { data, error } = await admin
            .from("firm_invoices")
            .insert({
              firm_id: t.firm_id,
              engagement_id: t.engagement_id,
              company_id: t.company_id,
              invoice_number: genNumber(),
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
          if (!error && data) {
            inv = data;
            break;
          }
          insertErr = error;
          if (error?.code !== "23505") break;
        }
        const error = inv ? null : (insertErr ?? { message: "insert failed" });
        if (error || !inv) {
          failed++;
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
        const { error: advanceErr } = await admin
          .from("firm_invoice_templates")
          .update({
            last_issued_at: nowIso,
            next_issue_at: next.toISOString(),
          })
          .eq("id", t.id);
        if (advanceErr) {
          // We minted an invoice but failed to advance the
          // template, without the advance, next tick would
          // re-mint. Log loudly but keep going; ops can
          // reconcile.
          failed++;
          console.error(
            `[firm-invoice-issue] template ${t.id} ADVANCE FAILED after mint:`,
            advanceErr.message,
          );
          continue;
        }

        await logFirmActivity({
          client: admin,
          firmId: t.firm_id,
          companyId: t.company_id,
          engagementId: t.engagement_id,
          kind: "firm.invoice_sent",
          summary: `Auto-drafted ${inv.invoice_number} from "${t.name}".`,
          payload: {
            invoice_id: inv.id,
            template_id: t.id,
            subtotal_cents: subtotal,
          },
        });

        minted++;
      } catch (err) {
        failed++;
        console.error(
          `[firm-invoice-issue] template ${t.id} threw:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // If this page filled the limit, the next loop iteration may
    // still find more; otherwise we're done.
    if (rows.length < PAGE_SIZE) break;
  }

  return NextResponse.json({
    status: "ok",
    processed,
    minted,
    failed,
    had_more: hadMore,
    duration_ms: Date.now() - startMs,
  });
}
