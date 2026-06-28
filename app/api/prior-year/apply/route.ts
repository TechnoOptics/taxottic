import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireFeatureGate } from "@/lib/plans/gate";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Take every prior_year_document the user has uploaded for a given
 * tax year and propagate the totals forward:
 *
 *   1. Update tax_profiles for the CURRENT year with W-2 totals from
 *      the prior year (employers usually carry; the user can edit).
 *      State code from any W-2.
 *   2. Spread Schedule C net income evenly across 12 months in
 *      monthly_income for the current year as a "baseline" entry, so
 *      the forecast has a non-zero starting point matching what the
 *      user actually earned last year.
 *   3. Spread Schedule C total_expenses similarly into
 *      monthly_expenses (using "office" as the placeholder category;
 *      the user can recategorize from the review queue).
 *   4. Spread 1099-NEC nonemployee comp into monthly_income too.
 *   5. Spread 1099-K gross_payments into monthly_income.
 *   6. Mark each doc as applied_at so it doesn't get applied twice.
 *
 * Body: { taxYear: number, companyId?: string }
 *
 * If companyId is provided, monthly_income/monthly_expenses entries
 * are created against that company. If absent, we pick the user's
 * primary company.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  // Same gate as /extract: applying prior-year totals to the forecast
  // is a Filer-and-above feature. We don't want a free user kicking
  // off the whole baseline-spread flow even though it's already been
  // gated at extract time, in case they obtained docs another way.
  const gateFail = await requireFeatureGate(
    supabase,
    user.id,
    "personalForecast",
  );
  if (gateFail) return gateFail;

  const body = await req.json().catch(() => ({}));
  const priorYear = body?.taxYear as number | undefined;
  const explicitCompanyId = body?.companyId as string | undefined;
  if (!priorYear) {
    return NextResponse.json(
      { error: "taxYear required" },
      { status: 400 },
    );
  }

  const currentYear = new Date().getUTCFullYear();
  const admin = createServiceClient();

  // Pick the company to apply baselines against. If the user has only
  // one company, easy. If multiple and no explicit pick, use the most
  // recent one.
  let companyId = explicitCompanyId ?? null;
  if (!companyId) {
    const { data: companies } = await supabase
      .from("companies")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1);
    companyId = companies?.[0]?.id ?? null;
  }

  // SECURITY: companyId can come straight from the request body, and every
  // write below uses the service-role client (which bypasses RLS). Verify the
  // caller actually belongs to this company, or they could spread their
  // prior-year totals into ANOTHER tenant's books.
  if (companyId) {
    const { data: membership } = await admin
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // Pull every prior-year doc the user uploaded that hasn't been
  // applied yet.
  const { data: docs } = await supabase
    .from("prior_year_documents")
    .select("id, doc_type, extracted_data, tax_year, for_person")
    .eq("user_id", user.id)
    .eq("tax_year", priorYear)
    .is("applied_at", null);

  if (!docs || docs.length === 0) {
    return NextResponse.json({ ok: true, applied: 0 });
  }

  let appliedDocs = 0;
  let monthlyRowsCreated = 0;
  let stateCode: string | null = null;
  // W-2 totals split by attribution. A married couple often has one
  // W-2 each; we sum into the owning bucket so the tax profile fields
  // for owner vs spouse pre-fill correctly.
  let ownerW2Wages = 0;
  let ownerW2Withheld = 0;
  let ownerW2SsWages = 0;
  let spouseW2Wages = 0;
  let spouseW2Withheld = 0;
  let spouseW2SsWages = 0;

  for (const doc of docs) {
    const fields = (doc.extracted_data as Record<string, number | string | null>) ?? {};
    const docType = doc.doc_type as string;
    const forPerson = (doc.for_person as string) === "spouse" ? "spouse" : "self";

    if (docType === "w2") {
      const wages = num(fields.wages_cents);
      const withheld = num(fields.federal_withheld_cents);
      const ssWages = num(fields.social_security_wages_cents);
      if (forPerson === "spouse") {
        spouseW2Wages += wages;
        spouseW2Withheld += withheld;
        spouseW2SsWages += ssWages;
      } else {
        ownerW2Wages += wages;
        ownerW2Withheld += withheld;
        ownerW2SsWages += ssWages;
      }
      if (typeof fields.state_code === "string" && fields.state_code) {
        stateCode = fields.state_code as string;
      }
    } else if (docType === "schedule_c" && companyId) {
      const net = num(fields.net_profit_cents);
      const totalExp = num(fields.total_expenses_cents);
      if (net > 0) {
        monthlyRowsCreated += await spreadOverYear(admin, {
          table: "monthly_income",
          companyId,
          userId: user.id,
          taxYear: currentYear,
          totalCents: net + totalExp, // gross income (revenue), not net
          extra: { source: "sales", notes: "Baseline from prior-year Schedule C" },
        });
      }
      if (totalExp > 0) {
        monthlyRowsCreated += await spreadOverYear(admin, {
          table: "monthly_expenses",
          companyId,
          userId: user.id,
          taxYear: currentYear,
          totalCents: totalExp,
          extra: {
            category_code: "office",
            notes: "Baseline from prior-year Schedule C - recategorize as needed",
          },
        });
      }
    } else if (docType === "1099_nec" && companyId) {
      const nec = num(fields.nonemployee_comp_cents);
      if (nec > 0) {
        monthlyRowsCreated += await spreadOverYear(admin, {
          table: "monthly_income",
          companyId,
          userId: user.id,
          taxYear: currentYear,
          totalCents: nec,
          extra: { source: "services", notes: "Baseline from prior-year 1099-NEC" },
        });
      }
    } else if (docType === "1099_k" && companyId) {
      const gross = num(fields.gross_payments_cents);
      if (gross > 0) {
        monthlyRowsCreated += await spreadOverYear(admin, {
          table: "monthly_income",
          companyId,
          userId: user.id,
          taxYear: currentYear,
          totalCents: gross,
          extra: { source: "sales", notes: "Baseline from prior-year 1099-K" },
        });
      }
    } else if (docType === "1099_misc" && companyId) {
      const rents = num(fields.rents_cents);
      const royalties = num(fields.royalties_cents);
      const other = num(fields.other_income_cents);
      const sum = rents + royalties + other;
      if (sum > 0) {
        const source = rents > 0 ? "rental" : royalties > 0 ? "royalty" : "other";
        monthlyRowsCreated += await spreadOverYear(admin, {
          table: "monthly_income",
          companyId,
          userId: user.id,
          taxYear: currentYear,
          totalCents: sum,
          extra: { source, notes: "Baseline from prior-year 1099-MISC" },
        });
      }
    } else if (docType === "1099_int" && companyId) {
      const interest = num(fields.interest_income_cents);
      if (interest > 0) {
        monthlyRowsCreated += await spreadOverYear(admin, {
          table: "monthly_income",
          companyId,
          userId: user.id,
          taxYear: currentYear,
          totalCents: interest,
          extra: {
            source: "interest",
            notes: "Baseline from prior-year 1099-INT",
          },
        });
      }
    } else if (docType === "1099_div" && companyId) {
      const div = num(fields.ordinary_dividends_cents);
      if (div > 0) {
        monthlyRowsCreated += await spreadOverYear(admin, {
          table: "monthly_income",
          companyId,
          userId: user.id,
          taxYear: currentYear,
          totalCents: div,
          extra: {
            source: "dividends",
            notes: "Baseline from prior-year 1099-DIV",
          },
        });
      }
    }

    appliedDocs++;
  }

  // Apply W-2 totals to the current year's tax_profile so the user's
  // forecast knows about their day-job wages. If they no longer hold
  // that job they can edit; assuming carry-over is the right default.
  // Split owner vs spouse so a couple's two W-2s land on the right
  // columns.
  if (ownerW2Wages > 0 || spouseW2Wages > 0) {
    const update: Record<string, number | string> = {
      user_id: user.id,
      tax_year: currentYear,
    };
    if (ownerW2Wages > 0) {
      update.owner_w2_wages_cents = ownerW2Wages;
      update.owner_w2_withheld_cents = ownerW2Withheld;
      update.owner_w2_ss_wages_cents = ownerW2SsWages;
    }
    if (spouseW2Wages > 0) {
      update.spouse_w2_wages_cents = spouseW2Wages;
      update.spouse_w2_withheld_cents = spouseW2Withheld;
      update.spouse_w2_ss_wages_cents = spouseW2SsWages;
    }
    if (stateCode) {
      update.state_code = stateCode;
    }
    await admin
      .from("tax_profiles")
      .upsert(update, { onConflict: "user_id,tax_year" });
  }

  // Mark every doc applied so we don't re-spread on re-runs.
  const docIds = docs.map((d) => d.id);
  await admin
    .from("prior_year_documents")
    .update({ applied_at: new Date().toISOString() })
    .in("id", docIds);

  return NextResponse.json({
    ok: true,
    applied: appliedDocs,
    monthly_rows_created: monthlyRowsCreated,
    w2_wages_carried_cents: ownerW2Wages + spouseW2Wages,
    owner_w2_wages_cents: ownerW2Wages,
    spouse_w2_wages_cents: spouseW2Wages,
  });
}

/**
 * Spread a yearly total evenly across 12 months. We deliberately use
 * 12 small inserts (one per month) rather than one annual row so the
 * monthly view in the forecast looks right. Returns the count of rows
 * actually inserted. Caller passes the service-role client so writes
 * bypass RLS as intended.
 */
async function spreadOverYear(
  admin: SupabaseClient,
  args: {
    table: "monthly_income" | "monthly_expenses";
    companyId: string;
    userId: string;
    taxYear: number;
    totalCents: number;
    extra: Record<string, string | null>;
  },
): Promise<number> {
  const { table, companyId, userId, taxYear, totalCents, extra } = args;
  if (totalCents <= 0) return 0;
  const perMonth = Math.floor(totalCents / 12);
  if (perMonth <= 0) return 0;
  const rows = Array.from({ length: 12 }, (_, i) => ({
    company_id: companyId,
    user_id: userId,
    tax_year: taxYear,
    month: i + 1,
    amount_cents: perMonth,
    ...extra,
  }));
  const { error, count } = await admin
    .from(table)
    .insert(rows, { count: "exact" });
  if (error) return 0;
  return count ?? rows.length;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
