import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMyCompanies, getCompaniesForUserId } from "@/lib/auth";
import { resolveWatchUserId } from "@/lib/watch/device-auth";
import { computeReadiness } from "@/lib/dashboard/readiness";
import { businessMileageDeductionCents } from "@/lib/mileage/deduction";
import { buildWatchSnapshot, type SnapshotInput } from "@/lib/watch/snapshot";
import { companyAccountIds } from "@/lib/banking/scope";
import { EMPTY_WATCH_SNAPSHOT, type WatchSnapshot } from "@/lib/watch/types";
import {
  buildCompanyForecast,
  type ForecastTaxProfile,
  type ForecastBusinessProfile,
  type IncomeRow,
  type ExpenseRow,
} from "@/lib/tax/company-forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/watch/snapshot
//
// The watch glance, assembled from existing well-tested cores. Auth
// via session; admin client for aggregate reads (same pattern as
// /api/push/action). EVERY section is best-effort, a failure in one
// field degrades that field to its empty default; the watch must
// never show an error. forecast / per-deduction $ / unsure
// expense+income are intentionally left to a follow-up (no fabricated
// tax numbers on the wrist); the swipe deck + pages already render
// them the moment the endpoint supplies them.
export async function GET(req: NextRequest) {
  // Dual auth: the phone hits this with a session cookie; the watch
  // hits it directly with `Authorization: Bearer <device token>`
  // (QR-pairing). Session is tried first and is unchanged; the bearer
  // path resolves the same account via the hashed device token.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viaSession = !!user;
  const uid =
    user?.id ??
    (await resolveWatchUserId(req.headers.get("authorization")));
  if (!uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const taxYear = new Date().getUTCFullYear();
  const admin = createServiceClient();

  let readinessScore: number | null = null;
  let ytdDeductionCents = 0;
  let todayBusinessMiles = 0;
  let todayDeductionCents = 0;
  let pendingTrips: SnapshotInput["pendingTrips"] = [];
  let pendingExpenses: SnapshotInput["pendingExpenses"] = [];
  let goals: SnapshotInput["goals"] = [];
  let latestBadgeCode: string | null = null;
  let newBadgeCode: string | null = null;
  let companyId: string | null = null;
  // Role in `companyId`, resolved from the caller's own memberships.
  // The bank sections below read through the service-role client, which
  // bypasses RLS, so they have to re-derive the boundary the policies
  // would otherwise apply.
  let isCompanyManager = false;
  let forecastOut: WatchSnapshot["forecast"] = undefined;
  let reward: SnapshotInput["reward"] = null;

  try {
    const companies = viaSession
      ? await getMyCompanies()
      : await getCompaniesForUserId(uid);
    // Companion-app contract: follow whichever company the user is
    // looking at on the phone (set by /c/[publicId] page renders).
    // Falls back to companies[0] when the user has never opened a
    // per-company page in this session or the active company was
    // soft-deleted (FK clears to null).
    const { data: profileRow } = await admin
      .from("profiles")
      .select("active_company_id")
      .eq("id", uid)
      .maybeSingle();
    const active = (profileRow as { active_company_id: string | null } | null)
      ?.active_company_id ?? null;
    // Validate the active company is still one the user belongs to -
    // a stale value from before they were removed from a company
    // shouldn't leak that company's numbers to the wrist.
    const belongs = active
      ? companies.some((c) => c.company.id === active)
      : false;
    companyId = belongs ? active : companies[0]?.company.id ?? null;
    isCompanyManager =
      companies.find((c) => c.company.id === companyId)?.role === "manager";
    if (companyId) {
      readinessScore = (await computeReadiness(admin, companyId, taxYear))
        .score;
    }
  } catch {
    /* dial → 0 */
  }

  try {
    const { data } = await admin
      .from("mileage_trips")
      .select("distance_miles")
      .eq("driver_user_id", uid)
      .eq("classification", "business")
      // These two tiles are the ONE deduction figure in the app derived
      // from summed miles instead of stored deduction_cents, so the
      // zero-cents guard on an assumed drive does not reach them. Exclude
      // the unconfirmed drives explicitly or the wrist would claim a
      // deduction the phone deliberately does not.
      .not("needs_confirmation", "is", true)
      .eq("tax_year", taxYear);
    const miles = (data ?? []).reduce(
      (s, r) => s + Number((r as { distance_miles: number }).distance_miles || 0),
      0,
    );
    ytdDeductionCents = businessMileageDeductionCents(miles, taxYear);
  } catch {
    /* $0 */
  }

  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data } = await admin
      .from("mileage_trips")
      .select("distance_miles")
      .eq("driver_user_id", uid)
      .eq("classification", "business")
      .not("needs_confirmation", "is", true)
      .gte("started_at", startOfDay.toISOString());
    todayBusinessMiles = (data ?? []).reduce(
      (s, r) => s + Number((r as { distance_miles: number }).distance_miles || 0),
      0,
    );
    todayDeductionCents = businessMileageDeductionCents(
      todayBusinessMiles,
      taxYear,
    );
  } catch {
    /* today 0 */
  }

  // outstandingCount is the TRUE total across every source below, the
  // arrays above/below are all capped preview lists for the swipe deck,
  // but a watch-face complication needs the real number (mirrors the
  // phone's header-bell count; see lib/tasks/outstanding.ts).
  let outstandingCount = 0;

  // Drives deliberately do NOT feed outstandingCount: they are
  // auto-classified on arrival, so there is no drive backlog to badge,
  // and the phone's bell no longer counts them either. The deck below
  // still lists any drive left unclassified on purpose (a manual "review
  // later"), so the swipe control stays reachable from the wrist.
  try {
    const { data } = await admin
      .from("mileage_trips")
      .select("id, distance_miles, started_at")
      .eq("driver_user_id", uid)
      .eq("classification", "unclassified")
      .order("started_at", { ascending: false })
      .limit(6);
    pendingTrips = (data ?? []).map((row) => {
      const t = row as {
        id: string;
        distance_miles: number;
        started_at: string;
      };
      const miles = Number(t.distance_miles || 0);
      return {
        id: t.id,
        distanceMiles: miles,
        startedAtISO: t.started_at,
        estDeductionCents: businessMileageDeductionCents(miles, taxYear),
      };
    });
  } catch {
    /* no pending trips */
  }

  try {
    const { data } = await admin
      .from("goals")
      .select("id, title, target_cents, saved_cents")
      .eq("user_id", uid)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(5);
    goals = (data ?? []).map((row) => {
      const g = row as {
        id: string;
        title: string;
        target_cents: number;
        saved_cents: number;
      };
      return {
        id: g.id,
        title: g.title,
        savedCents: Number(g.saved_cents || 0),
        targetCents: Number(g.target_cents || 0),
      };
    });
  } catch {
    /* no goals */
  }

  // Reward: a goal just reached its target → celebrate on the wrist.
  const hitGoal = goals.find(
    (g) => g.targetCents > 0 && g.savedCents >= g.targetCents,
  );
  if (hitGoal) reward = { title: "Goal reached!", detail: hitGoal.title };

  // Bank-synced transactions awaiting a business-or-personal call -
  // the swipe deck's expense cards, and the home-screen widget's, since
  // lib/widget/bridge.ts and lib/watch/bridge.ts both pull this same
  // endpoint from the phone.
  //
  // BOTH sources below are read with `admin`, the service-role client,
  // which bypasses RLS entirely. Nothing about these queries is
  // "RLS-scoped"; every filter that keeps one tenant's bank data off
  // another tenant's wrist has to be written out here by hand, and it
  // has to reproduce what the policies say:
  //
  //   bank_transactions    manager sees the company's rows; anyone else
  //                        sees only transactions from imports they
  //                        uploaded (ownership lives on
  //                        bank_imports.user_id, there is no user_id on
  //                        the transaction).
  //   account_transactions manager-only, and reachable only through
  //                        account -> connection -> company, since the
  //                        table carries no company_id of its own.
  if (companyId) {
    try {
      // Non-managers: restrict to their own imports first, so the
      // transaction query can be a plain `import_id in (...)`.
      let ownImportIds: string[] | null = null;
      if (!isCompanyManager) {
        const { data: mine } = await admin
          .from("bank_imports")
          .select("id")
          .eq("company_id", companyId)
          .eq("user_id", uid);
        ownImportIds = (mine ?? []).map((r) => (r as { id: string }).id);
      }
      if (ownImportIds === null || ownImportIds.length > 0) {
        let q = admin
          .from("bank_transactions")
          .select("id, description, amount_cents", { count: "exact" })
          .eq("company_id", companyId)
          .eq("ignored", false)
          .is("applied_category_code", null)
          .is("applied_expense_id", null)
          .is("applied_income_id", null);
        if (ownImportIds !== null) q = q.in("import_id", ownImportIds);
        const { data, count } = await q
          .order("posted_at", { ascending: false })
          .limit(8);
        outstandingCount += count ?? 0;
        pendingExpenses.push(
          ...(data ?? []).map((row) => {
            const t = row as {
              id: string;
              description: string | null;
              amount_cents: number;
            };
            return {
              id: t.id,
              kind: "expense" as const,
              label: (t.description || "Bank expense").slice(0, 40),
              note: "needs business or personal",
              amountCents: Math.abs(Number(t.amount_cents || 0)),
            };
          }),
        );
      }
    } catch {
      /* no CSV bank feed yet */
    }
    try {
      // Manager-only, matching the "acct_tx: manager read" policy. A
      // non-manager has no live-feed rows to triage, so there is
      // nothing to fetch.
      const accountIds = isCompanyManager
        ? await companyAccountIds(admin, companyId)
        : [];
      if (accountIds.length > 0) {
        const { data, count } = await admin
          .from("account_transactions")
          .select("id, description, merchant_name, amount_cents", {
            count: "exact",
          })
          .in("account_id", accountIds)
          .eq("user_action", "pending")
          .order("posted_date", { ascending: false })
          .limit(8);
        outstandingCount += count ?? 0;
        pendingExpenses.push(
          ...(data ?? []).map((row) => {
            const t = row as {
              id: string;
              description: string | null;
              merchant_name: string | null;
              amount_cents: number;
            };
            return {
              id: t.id,
              kind: "expense" as const,
              label: (t.merchant_name || t.description || "Bank expense").slice(
                0,
                40,
              ),
              note: "needs business or personal",
              amountCents: Math.abs(Number(t.amount_cents || 0)),
            };
          }),
        );
      }
    } catch {
      /* no Plaid-synced feed yet */
    }
    // Preview list stays a manageable size for the swipe deck even
    // though outstandingCount above already carries the true total.
    pendingExpenses = pendingExpenses.slice(0, 8);
  }

  try {
    const { data } = await admin
      .from("badges")
      .select("badge_code, awarded_at")
      .eq("user_id", uid)
      .order("awarded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const b = data as { badge_code: string; awarded_at: string } | null;
    if (b) {
      latestBadgeCode = b.badge_code;
      // Fresh medal (< 10 min) → one-shot celebration on the wrist.
      const awarded = new Date(b.awarded_at).getTime();
      if (Number.isFinite(awarded) && Date.now() - awarded < 10 * 60_000) {
        newBadgeCode = b.badge_code;
      }
    }
  } catch {
    /* no badges */
  }

  // Real projected forecast, via the SAME buildCompanyForecast the
  // forecast page uses, so the wrist number can't diverge from the
  // app. Best-effort: if the tax profile isn't set up yet (the page
  // would redirect to onboarding) we just omit forecast and the watch
  // shows its elegant "updates on your iPhone" state.
  if (companyId) {
    try {
      const [companyRes, tpRes, bpRes, incRes, expRes, tripRes] =
        await Promise.all([
          admin
            .from("companies")
            .select("state_code, entity_type")
            .eq("id", companyId)
            .maybeSingle(),
          admin
            .from("tax_profiles")
            .select("*")
            .eq("user_id", uid)
            .eq("tax_year", taxYear)
            .maybeSingle(),
          admin
            .from("business_profiles")
            .select("*")
            .eq("company_id", companyId)
            .eq("tax_year", taxYear)
            .maybeSingle(),
          admin
            .from("monthly_income")
            .select("amount_cents, month, recurrence")
            .eq("company_id", companyId)
            .eq("tax_year", taxYear),
          admin
            .from("monthly_expenses")
            .select("amount_cents, month, category_code, recurrence")
            .eq("company_id", companyId)
            .eq("tax_year", taxYear),
          admin
            .from("mileage_trips")
            .select("deduction_cents")
            .eq("company_id", companyId)
            .eq("classification", "business")
            .eq("tax_year", taxYear),
        ]);
      const taxProfile = tpRes.data as ForecastTaxProfile | null;
      if (taxProfile) {
        const company = (companyRes.data ?? {}) as {
          state_code: string | null;
          entity_type: string | null;
        };
        const trips = (tripRes.data ?? []) as unknown as {
          deduction_cents: number;
        }[];
        const { result } = buildCompanyForecast({
          taxYear,
          currentMonth: new Date().getUTCMonth() + 1,
          company: {
            state_code: company.state_code ?? null,
            entity_type: company.entity_type ?? null,
          },
          taxProfile,
          businessProfile:
            (bpRes.data as ForecastBusinessProfile | null) ?? null,
          incomes: (incRes.data ?? []) as IncomeRow[],
          expenses: (expRes.data ?? []) as ExpenseRow[],
          trackedYtdMileageCents: trips.reduce(
            (a, t) => a + Number(t.deduction_cents ?? 0),
            0,
          ),
          trackedTripCount: trips.length,
        });
        const net =
          result.stillOwedCents > 0
            ? result.stillOwedCents
            : -result.refundCents;
        forecastOut = {
          label: `${taxYear} projected estimate`,
          netCents: net,
          effectiveRatePct: Math.round((result.overallEffectiveRate ?? 0) * 100),
          ytdIncomeCents: result.projectedIncomeCents ?? 0,
        };
      }
    } catch {
      /* tax profile missing / engine unavailable, omit forecast */
    }
  }

  // Server-derived "is tracking actually running right now?" so the
  // watch's Auto-track toggle reflects reality after the next sync.
  // Heuristic: any mileage_points captured in the last 5 minutes →
  // the phone's foreground service is alive. Avoids a separate
  // mirror column + extra POST from the phone on every start/stop.
  let trackingActive = false;
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: recentPing } = await admin
      .from("mileage_points")
      .select("captured_at")
      .gte("captured_at", fiveMinAgo)
      .eq("driver_user_id", uid)
      .limit(1)
      .maybeSingle();
    trackingActive = !!recentPing;
  } catch {
    /* no points yet, leave false */
  }

  // Server-mirrored auto-apply-business preference. Stored alongside
  // the user's schedule on profiles.mileage_schedule JSONB. Watch's
  // toggle reads from here so the watch + phone agree.
  let autoApplyBusiness = false;
  try {
    const { data: prof } = await admin
      .from("profiles")
      .select("mileage_schedule")
      .eq("id", uid)
      .maybeSingle();
    const sched =
      (prof?.mileage_schedule as { autoApplyBusiness?: boolean } | null) ?? null;
    autoApplyBusiness = sched?.autoApplyBusiness === true;
  } catch {
    /* profile row missing in dev, default to off */
  }

  try {
    return NextResponse.json(
      buildWatchSnapshot({
        readinessScore,
        ytdDeductionCents,
        todayBusinessMiles,
        todayDeductionCents,
        pendingTrips,
        pendingExpenses,
        goals,
        outstandingCount,
        deductions: [],
        forecast: forecastOut,
        latestBadgeCode,
        newBadgeCode,
        companyId,
        trackingActive,
        autoApplyBusiness,
        reward,
      }),
    );
  } catch {
    return NextResponse.json(EMPTY_WATCH_SNAPSHOT);
  }
}
