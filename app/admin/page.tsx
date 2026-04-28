import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";

export default async function AdminPage() {
  const { supabase, user } = await requireSuperAdmin();

  const [{ count: userCount }, { count: companyCount }, { count: inviteCount }] =
    await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("companies").select("*", { count: "exact", head: true }),
      supabase
        .from("invitations")
        .select("*", { count: "exact", head: true })
        .is("accepted_at", null),
    ]);

  const { data: recentCompanies } = await supabase
    .from("companies")
    .select("public_id, name, entity_type, state_code, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: recentUsers } = await supabase
    .from("profiles")
    .select("public_id, email, full_name, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              Super admin
            </div>
            <h1 className="display mt-2 text-4xl text-forest-900">
              Taxottic operations
            </h1>
          </div>
          <Link
            href="/dashboard"
            className="text-sm text-ink-soft hover:text-forest-800"
          >
            App view &rarr;
          </Link>
        </div>

        <section className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Stat label="Users" value={userCount ?? 0} />
          <Stat label="Companies" value={companyCount ?? 0} />
          <Stat label="Pending invites" value={inviteCount ?? 0} />
        </section>

        <section className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Recent companies">
            <ul className="divide-y divide-forest-100">
              {recentCompanies?.map((c) => (
                <li
                  key={c.public_id}
                  className="py-2.5 text-sm flex justify-between"
                >
                  <span className="font-medium text-forest-900">{c.name}</span>
                  <span className="text-xs text-ink-muted tracking-wide">
                    {c.public_id} - {c.state_code}
                  </span>
                </li>
              ))}
              {!recentCompanies?.length ? (
                <li className="py-3 text-xs text-ink-muted">
                  No companies yet.
                </li>
              ) : null}
            </ul>
          </Card>

          <Card title="Recent users">
            <ul className="divide-y divide-forest-100">
              {recentUsers?.map((u) => (
                <li
                  key={u.public_id}
                  className="py-2.5 text-sm flex justify-between"
                >
                  <span className="text-forest-900">
                    {u.full_name ?? u.email}
                  </span>
                  <span className="text-xs text-ink-muted tracking-wide">
                    {u.public_id}
                  </span>
                </li>
              ))}
              {!recentUsers?.length ? (
                <li className="py-3 text-xs text-ink-muted">No users yet.</li>
              ) : null}
            </ul>
          </Card>
        </section>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-6">
      <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
        {label}
      </div>
      <div className="mt-2 display text-4xl text-forest-900">{value}</div>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-6">
      <h2 className="display text-xl text-forest-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}
