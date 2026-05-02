import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { createServiceClient } from "@/lib/supabase/server";

const FILING_LABEL: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "Married, joint",
  married_filing_separately: "Married, separate",
  head_of_household: "Head of household",
  qualifying_widow: "Qualifying widow(er)",
};

const ENTITY_LABEL: Record<string, string> = {
  sole_prop: "Sole Prop",
  single_llc: "Single-Member LLC",
  multi_llc: "Multi-Member LLC",
  s_corp: "S-Corp",
  c_corp: "C-Corp",
  partnership: "Partnership",
  self_employed_1099: "1099 / Self-Employed",
};

export default async function AdminPage() {
  const { user } = await requireSuperAdmin();
  const admin = createServiceClient();
  const taxYear = new Date().getUTCFullYear();

  const [
    { data: profiles },
    { data: subscriptions },
    { data: taxProfiles },
    { data: companyMembers },
    { data: companies },
    { count: totalUsers },
    { count: totalCompanies },
    { count: pendingFeedback },
    { count: openInvites },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "id, public_id, email, full_name, created_at, gdpr_consented_at, is_blocked, blocked_reason",
      )
      .order("created_at", { ascending: false })
      .limit(500),
    admin
      .from("subscriptions")
      .select("user_id, plan, status, current_period_end"),
    admin
      .from("tax_profiles")
      .select("user_id, filing_status")
      .eq("tax_year", taxYear),
    admin
      .from("company_members")
      .select("user_id, company_id, role"),
    admin.from("companies").select("id, public_id, name, entity_type"),
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("companies").select("id", { count: "exact", head: true }),
    admin
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("status", "new"),
    admin
      .from("invitations")
      .select("id", { count: "exact", head: true })
      .is("accepted_at", null),
  ]);

  const subByUser = new Map<
    string,
    { plan: string; status: string; period_end: string | null }
  >();
  for (const s of subscriptions ?? []) {
    subByUser.set(s.user_id, {
      plan: s.plan,
      status: s.status,
      period_end: s.current_period_end,
    });
  }
  const filingByUser = new Map<string, string>();
  for (const t of taxProfiles ?? []) filingByUser.set(t.user_id, t.filing_status);

  const companyById = new Map<
    string,
    { public_id: string; name: string; entity_type: string | null }
  >();
  for (const c of companies ?? []) {
    companyById.set(c.id, {
      public_id: c.public_id,
      name: c.name,
      entity_type: c.entity_type,
    });
  }
  // First-company entity_type per user
  const entityByUser = new Map<string, string>();
  for (const m of companyMembers ?? []) {
    if (!entityByUser.has(m.user_id)) {
      const co = companyById.get(m.company_id);
      if (co?.entity_type) entityByUser.set(m.user_id, co.entity_type);
    }
  }

  // Group profiles by filing status (or "_unset" if missing).
  const groups = new Map<string, typeof profiles>();
  for (const p of profiles ?? []) {
    const key = filingByUser.get(p.id) ?? "_unset";
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  // Stable order: known statuses first in declaration order, then unset.
  const orderedGroupKeys = [
    ...Object.keys(FILING_LABEL).filter((k) => groups.has(k)),
    ...(groups.has("_unset") ? ["_unset"] : []),
  ];

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} homeHref="/" />
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              Super admin
            </div>
            <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
              Operations
            </h1>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link href="/firms" className="btn-ghost">
              Tax-prep firms
            </Link>
            <Link href="/feedback" className="btn-ghost">
              Feedback{" "}
              {(pendingFeedback ?? 0) > 0 ? (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-red-600 text-white text-[10px] min-w-5 h-5 px-1">
                  {pendingFeedback}
                </span>
              ) : null}
            </Link>
            <a href="https://taxottic.com/dashboard" className="btn-ghost">
              App view
            </a>
          </div>
        </div>

        <section className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Users" value={totalUsers ?? 0} />
          <Stat label="Companies" value={totalCompanies ?? 0} />
          <Stat label="Open invites" value={openInvites ?? 0} />
          <Stat
            label="New feedback"
            value={pendingFeedback ?? 0}
            accent={(pendingFeedback ?? 0) > 0}
          />
        </section>

        <section className="mt-10">
          <h2 className="display text-xl text-forest-900">
            Users by filing structure
          </h2>
          <p className="text-xs text-ink-muted mt-1">
            Click a user to see details. Forever-admin emails cannot be
            blocked.
          </p>

          <div className="mt-5 grid gap-5">
            {orderedGroupKeys.length === 0 ? (
              <p className="text-sm text-ink-muted">No users yet.</p>
            ) : (
              orderedGroupKeys.map((key) => (
                <FilingGroup
                  key={key}
                  filingKey={key}
                  users={(groups.get(key) ?? []) as never}
                  subByUser={subByUser}
                  entityByUser={entityByUser}
                />
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function FilingGroup({
  filingKey,
  users,
  subByUser,
  entityByUser,
}: {
  filingKey: string;
  users: Array<{
    id: string;
    public_id: string;
    email: string;
    full_name: string | null;
    created_at: string;
    gdpr_consented_at: string | null;
    is_blocked: boolean;
    blocked_reason: string | null;
  }>;
  subByUser: Map<
    string,
    { plan: string; status: string; period_end: string | null }
  >;
  entityByUser: Map<string, string>;
}) {
  const label =
    filingKey === "_unset" ? "Filing status not set" : FILING_LABEL[filingKey];
  return (
    <div>
      <div className="flex items-end justify-between mb-3">
        <h3 className="text-sm font-medium text-forest-800">
          {label}{" "}
          <span className="text-ink-muted ml-1 font-normal">
            ({users.length})
          </span>
        </h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {users.map((u) => {
          const sub = subByUser.get(u.id);
          const entity = entityByUser.get(u.id);
          return (
            <Link
              key={u.id}
              href={`/user/${u.id}`}
              className="card card-hover p-4 flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-forest-900 truncate">
                    {u.full_name ?? u.email}
                  </div>
                  <div className="text-xs text-ink-muted truncate">
                    {u.email}
                  </div>
                </div>
                {u.is_blocked ? (
                  <span className="text-[10px] uppercase tracking-wide text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 shrink-0">
                    Blocked
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px] uppercase tracking-wide">
                <Pill tone={sub?.plan === "pro" ? "gold" : "neutral"}>
                  {sub?.plan ? sub.plan : "free"}
                </Pill>
                <Pill
                  tone={
                    sub?.status === "active" || sub?.status === "trialing"
                      ? "ok"
                      : sub?.status
                        ? "warn"
                        : "neutral"
                  }
                >
                  {sub?.status ?? "—"}
                </Pill>
                <Pill tone={u.gdpr_consented_at ? "ok" : "warn"}>
                  GDPR {u.gdpr_consented_at ? "✓" : "—"}
                </Pill>
                {entity ? (
                  <Pill tone="neutral">{ENTITY_LABEL[entity] ?? entity}</Pill>
                ) : null}
              </div>
              <div className="text-[11px] text-ink-muted">
                {u.public_id} - joined{" "}
                {new Date(u.created_at).toLocaleDateString()}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
        {label}
      </div>
      <div
        className={
          "mt-1 display text-3xl " +
          (accent ? "text-red-700" : "text-forest-900")
        }
      >
        {value}
      </div>
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "gold" | "neutral";
  children: React.ReactNode;
}) {
  const cls = {
    ok: "bg-emerald-50 border-emerald-200 text-emerald-800",
    warn: "bg-amber-50 border-amber-200 text-amber-800",
    gold: "bg-gold-50 border-gold-300 text-gold-700",
    neutral: "bg-white border-forest-100 text-ink-soft",
  }[tone];
  return (
    <span
      className={`rounded border px-1.5 py-0.5 ${cls}`}
    >
      {children}
    </span>
  );
}
