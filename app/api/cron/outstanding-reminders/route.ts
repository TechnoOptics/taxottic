import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { notify } from "@/lib/push";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Outstanding-tasks reminder cron.
 *
 * Same "needs a business/personal or category call" backlog the header
 * bell / on-load popup / dashboard banner surface (lib/tasks/outstanding.ts)
 *, this is the proactive push nudge so a user who hasn't opened the app
 * still hears about a growing backlog. Runs once daily; `notify()`'s
 * dedupe (keyed on today's date, see lib/push/payloads.ts) means a more
 * frequent schedule would still only ever deliver once per user per day.
 *
 * One backlog source: pending bank/CSV transactions, reminded to every
 * MANAGER of the company the transactions belong to (member drivers
 * don't necessarily see the books; managers do).
 *
 * Drives are deliberately NOT a source. A finished drive is
 * auto-classified when it materialises, so there is no drive backlog to
 * nudge about. See lib/tasks/outstanding.ts, which this cron mirrors.
 *
 * Auth: same convention as every other cron in this codebase, Vercel's
 * `x-vercel-cron: 1` header on scheduled runs, or `Authorization: Bearer
 * $CRON_SECRET` for manual/debug triggering.
 */
export async function GET(req: NextRequest) {
  const isCron = req.headers.get("x-vercel-cron") === "1";
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  const isAuthed = !!secret && auth === `Bearer ${secret}`;
  if (!isCron && !isAuthed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const perUserCount = new Map<string, number>();
  const add = (userId: string, n: number) =>
    perUserCount.set(userId, (perUserCount.get(userId) ?? 0) + n);

  // Pending transactions (CSV-imported + Plaid-synced), grouped by
  // company, then fanned out to that company's managers.
  const pendingByCompany = new Map<string, number>();
  try {
    const { data: csvRows, error: csvErr } = await admin
      .from("bank_transactions")
      .select("company_id")
      .eq("ignored", false)
      .is("applied_category_code", null)
      .is("applied_expense_id", null)
      .is("applied_income_id", null)
      .limit(20_000);
    if (csvErr) throw csvErr;
    for (const r of csvRows ?? []) {
      const cid = r.company_id as string;
      pendingByCompany.set(cid, (pendingByCompany.get(cid) ?? 0) + 1);
    }
  } catch (err) {
    console.error(
      "[outstanding-reminders] csv-transaction scan failed",
      err instanceof Error ? err.message : String(err),
    );
  }
  try {
    // account_transactions has no company_id column directly, resolve it
    // through bank_accounts → bank_connections, same join the rest of the
    // banking feature uses.
    const { data: pendingTx, error: pendErr } = await admin
      .from("account_transactions")
      .select("account_id")
      .eq("user_action", "pending")
      .limit(20_000);
    if (pendErr) throw pendErr;
    const accountIds = [
      ...new Set((pendingTx ?? []).map((r) => r.account_id as string)),
    ];
    if (accountIds.length > 0) {
      const { data: accounts, error: acctErr } = await admin
        .from("bank_accounts")
        .select("id, connection_id")
        .in("id", accountIds);
      if (acctErr) throw acctErr;
      const connectionIds = [
        ...new Set((accounts ?? []).map((a) => a.connection_id as string)),
      ];
      const { data: connections, error: connErr } = await admin
        .from("bank_connections")
        .select("id, company_id")
        .in("id", connectionIds.length > 0 ? connectionIds : [""]);
      if (connErr) throw connErr;
      const connToCompany = new Map(
        (connections ?? []).map((c) => [c.id as string, c.company_id as string]),
      );
      const accountToCompany = new Map(
        (accounts ?? []).map((a) => [
          a.id as string,
          connToCompany.get(a.connection_id as string) ?? null,
        ]),
      );
      const countByAccount = new Map<string, number>();
      for (const r of pendingTx ?? []) {
        const aid = r.account_id as string;
        countByAccount.set(aid, (countByAccount.get(aid) ?? 0) + 1);
      }
      for (const [aid, n] of countByAccount) {
        const cid = accountToCompany.get(aid);
        if (!cid) continue;
        pendingByCompany.set(cid, (pendingByCompany.get(cid) ?? 0) + n);
      }
    }
  } catch (err) {
    console.error(
      "[outstanding-reminders] account-transaction scan failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  // Fan the per-company transaction counts out to that company's managers.
  if (pendingByCompany.size > 0) {
    try {
      const { data: managers, error } = await admin
        .from("company_members")
        .select("company_id, user_id")
        .eq("role", "manager")
        .in("company_id", [...pendingByCompany.keys()]);
      if (error) throw error;
      for (const m of managers ?? []) {
        const n = pendingByCompany.get(m.company_id as string) ?? 0;
        if (n > 0) add(m.user_id as string, n);
      }
    } catch (err) {
      console.error(
        "[outstanding-reminders] manager fan-out failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Send at most one notification per user, deduped by today's date (see
  // buildPayload's "outstanding_reminder" case) so re-running this cron
  // the same day is always a safe no-op.
  const dayKey = new Date().toISOString().slice(0, 10);
  let notified = 0;
  for (const [userId, count] of perUserCount) {
    if (count <= 0) continue;
    const result = await notify(userId, {
      kind: "outstanding_reminder",
      count,
      dayKey,
    });
    if (result.sent) notified++;
  }

  console.log(
    `[outstanding-reminders] users=${perUserCount.size} notified=${notified}`,
  );

  return NextResponse.json({
    ok: true,
    usersConsidered: perUserCount.size,
    notified,
  });
}
