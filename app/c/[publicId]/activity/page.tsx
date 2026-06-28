import { AppHeader } from "@/components/AppHeader";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { createServiceClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/format/relative-time";

type Params = Promise<{ publicId: string }>;

type ActivityRow = {
  id: string;
  actor_user_id: string | null;
  kind: string;
  summary: string;
  created_at: string;
};

// Friendly label + accent per activity kind. Unknown kinds fall back to a
// neutral "Activity" so a future kind never renders blank.
const KIND_META: Record<string, { label: string; tone: string }> = {
  "income.created": { label: "Income added", tone: "text-emerald-700" },
  "income.updated": { label: "Income edited", tone: "text-forest-700" },
  "income.deleted": { label: "Income removed", tone: "text-red-700" },
  "expense.created": { label: "Expense added", tone: "text-emerald-700" },
  "expense.updated": { label: "Expense edited", tone: "text-forest-700" },
  "expense.deleted": { label: "Expense removed", tone: "text-red-700" },
  "profile.updated": { label: "Profile updated", tone: "text-forest-700" },
  "bank.connected": { label: "Bank connected", tone: "text-emerald-700" },
  "bank.disconnected": { label: "Bank disconnected", tone: "text-red-700" },
};

export default async function ActivityPage({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);

  const { data } = await supabase
    .from("company_activity")
    .select("id, actor_user_id, kind, summary, created_at")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const events = (data ?? []) as ActivityRow[];

  // Resolve actor display names (service role can read teammates' profiles).
  const actorIds = [
    ...new Set(events.map((e) => e.actor_user_id).filter((v): v is string => Boolean(v))),
  ];
  const nameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const admin = createServiceClient();
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", actorIds);
    for (const p of profs ?? []) {
      nameById.set(p.id, p.full_name || p.email || "A teammate");
    }
  }
  const actorName = (id: string | null): string =>
    id == null ? "System" : id === user.id ? "You" : nameById.get(id) ?? "A teammate";

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.name}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">Activity</h1>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed">
          A record of changes to this company&rsquo;s books — who added, edited,
          or removed income and expenses, updated the profile, or connected a
          bank. The 100 most recent events are shown.
        </p>

        {events.length === 0 ? (
          <div className="card mt-6 p-8 text-center text-sm text-ink-muted">
            No activity yet. Changes you and your team make will show up here.
          </div>
        ) : (
          <ul className="mt-6 card divide-y divide-forest-100/60">
            {events.map((e) => {
              const meta = KIND_META[e.kind] ?? {
                label: "Activity",
                tone: "text-forest-700",
              };
              return (
                <li key={e.id} className="flex items-start gap-3 p-4">
                  <span
                    aria-hidden
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.tone.replace("text-", "bg-")}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className={`text-xs font-semibold ${meta.tone}`}>
                        {meta.label}
                      </span>
                      <span className="text-[11px] text-ink-muted">
                        {actorName(e.actor_user_id)} · {relativeTime(e.created_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-ink-soft">{e.summary}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
