import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

// Download-my-data endpoint.
//
// GET /api/export/data returns a single JSON file (Content-Disposition:
// attachment) containing every row the signed-in user owns or
// participates in across the platform. Covers GDPR's "right to data
// portability" + the user-facing "let me grab a copy before deleting
// my account" promise on /settings/data.
//
// Implementation notes:
//   - Uses the service-role client because we want this to succeed
//     regardless of RLS policies — the user is authenticated via
//     requireUser() so we know the identity is real. Each query is
//     explicitly scoped to user_id or to companies the user belongs to.
//   - The shape is documented inline below so a downstream importer
//     (or another tax product) can reason about it without us writing a
//     separate schema file.
//   - We deliberately INCLUDE soft-deleted rows so an export-then-
//     delete flow gives the user their complete history, including
//     items still in the recycle bin. The metadata `deleted_at` is
//     surfaced so a re-importer can preserve grace-window state.
//   - We deliberately EXCLUDE bank-connection access tokens
//     (`bank_connection_secrets`) — those are live credentials, not
//     user data. The user can re-link to get fresh tokens.
//
// Cost: bounded by the number of rows the user owns. Even a power
// user with multiple companies and a year of transactions tops out
// under a few MB.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportEnvelope = {
  // Schema version of the export shape. Increment when fields change.
  schema_version: 1;
  generated_at: string;
  user: {
    id: string;
    email: string | null;
    full_name: string | null;
    public_id: string | null;
    created_at: string | null;
    gdpr_consented_at: string | null;
    notes: string;
  };
  companies: Array<{
    id: string;
    public_id: string;
    name: string;
    entity_type: string | null;
    state_code: string | null;
    created_at: string;
    deleted_at: string | null;
    members: unknown[];
    business_profiles: unknown[];
    monthly_income: unknown[];
    monthly_expenses: unknown[];
    bank_connections: unknown[];
    bank_accounts: unknown[];
    account_transactions: unknown[];
  }>;
  reminders: unknown[];
  goals: unknown[];
  badges: unknown[];
  feedback_submissions: unknown[];
  notes: {
    excluded: string[];
  };
};

export async function GET() {
  const { user } = await requireUser();
  const admin = createServiceClient();

  // Pull the user's profile (the public-facing version).
  const { data: profile } = await admin
    .from("profiles")
    .select(
      "public_id, email, full_name, gdpr_consented_at, created_at, tax_filer_type, active_platform",
    )
    .eq("id", user.id)
    .maybeSingle();

  // Companies the user is a member of (includes soft-deleted by
  // design — the export should be the user's full history).
  const { data: memberships } = await admin
    .from("company_members")
    .select("company_id, role, joined_at")
    .eq("user_id", user.id);

  const companyIds = (memberships ?? []).map(
    (m: { company_id: string }) => m.company_id,
  );

  const companies: ExportEnvelope["companies"] = [];
  if (companyIds.length > 0) {
    const { data: companyRows } = await admin
      .from("companies")
      .select(
        "id, public_id, name, entity_type, state_code, created_at, deleted_at",
      )
      .in("id", companyIds);

    for (const c of companyRows ?? []) {
      const [
        { data: members },
        { data: bps },
        { data: incomeRows },
        { data: expenseRows },
        { data: conns },
        { data: accts },
        { data: txs },
      ] = await Promise.all([
        admin
          .from("company_members")
          .select("user_id, role, joined_at, title")
          .eq("company_id", c.id),
        admin
          .from("business_profiles")
          .select("*")
          .eq("company_id", c.id),
        admin
          .from("monthly_income")
          .select("*")
          .eq("company_id", c.id),
        admin
          .from("monthly_expenses")
          .select("*")
          .eq("company_id", c.id),
        admin
          .from("bank_connections")
          .select(
            "id, provider, institution_name, status, last_synced_at, last_error, created_at, deleted_at",
          )
          .eq("company_id", c.id),
        admin
          .from("bank_accounts")
          .select("*")
          .in(
            "connection_id",
            (
              await admin
                .from("bank_connections")
                .select("id")
                .eq("company_id", c.id)
            ).data?.map((r: { id: string }) => r.id) ?? [],
          ),
        admin
          .from("account_transactions")
          .select("*")
          .in(
            "account_id",
            (
              await admin
                .from("bank_accounts")
                .select("id, connection_id")
                .in(
                  "connection_id",
                  (
                    await admin
                      .from("bank_connections")
                      .select("id")
                      .eq("company_id", c.id)
                  ).data?.map((r: { id: string }) => r.id) ?? [],
                )
            ).data?.map((r: { id: string }) => r.id) ?? [],
          ),
      ]);

      companies.push({
        id: c.id,
        public_id: c.public_id,
        name: c.name,
        entity_type: c.entity_type,
        state_code: c.state_code,
        created_at: c.created_at,
        deleted_at: c.deleted_at,
        members: members ?? [],
        business_profiles: bps ?? [],
        monthly_income: incomeRows ?? [],
        monthly_expenses: expenseRows ?? [],
        bank_connections: conns ?? [],
        bank_accounts: accts ?? [],
        account_transactions: txs ?? [],
      });
    }
  }

  // User-scoped (not company-scoped) data.
  const [
    { data: reminders },
    { data: goals },
    { data: badges },
    { data: feedback },
  ] = await Promise.all([
    admin.from("reminders").select("*").eq("user_id", user.id),
    admin.from("goals").select("*").eq("user_id", user.id),
    admin
      .from("badges")
      .select("badge_code, awarded_at")
      .eq("user_id", user.id),
    admin
      .from("feedback_submissions")
      .select("id, kind, subject, body, page_url, created_at")
      .eq("user_id", user.id),
  ]);

  const envelope: ExportEnvelope = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email ?? null,
      full_name: profile?.full_name ?? null,
      public_id: profile?.public_id ?? null,
      created_at: profile?.created_at ?? null,
      gdpr_consented_at: profile?.gdpr_consented_at ?? null,
      notes:
        "This export includes every row Taxottic stores about you, including items currently in the recycle bin (`deleted_at` will be set on those). Bank-connection ACCESS TOKENS are intentionally excluded — they are live credentials, not user data. Re-link the institution to get fresh tokens.",
    },
    companies,
    reminders: reminders ?? [],
    goals: goals ?? [],
    badges: badges ?? [],
    feedback_submissions: feedback ?? [],
    notes: {
      excluded: [
        "bank_connection_secrets.access_token — live Plaid/Stripe credential",
        "auth.users.encrypted_password — Supabase-managed, not exposed via this API",
        "internal admin-only tables (super_admins, audit logs)",
      ],
    },
  };

  // Filename includes the date so multiple downloads in the same week
  // don't overwrite each other in the user's Downloads folder.
  const today = new Date().toISOString().slice(0, 10);
  const filename = `taxottic-export-${today}.json`;

  return new NextResponse(JSON.stringify(envelope, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Don't cache the export — content changes with each new
      // transaction, and we don't want intermediate caches storing
      // a copy.
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
