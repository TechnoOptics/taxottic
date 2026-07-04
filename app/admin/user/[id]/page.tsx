import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { createServiceClient } from "@/lib/supabase/server";
import { blockUser, unblockUser, deleteUserHard } from "../../actions";
import { TypedConfirmDelete } from "@/components/admin/TypedConfirmDelete";

type Params = Promise<{ id: string }>;

export default async function AdminUserPage({ params }: { params: Params }) {
  const { id } = await params;
  const { user: adminUser } = await requireSuperAdmin();
  const admin = createServiceClient();

  const [{ data: profile }, { data: sub }, { data: members }, { data: events }] =
    await Promise.all([
      admin
        .from("profiles")
        .select(
          "id, public_id, email, full_name, avatar_url, created_at, gdpr_consented_at, is_blocked, blocked_at, blocked_reason",
        )
        .eq("id", id)
        .maybeSingle(),
      admin
        .from("subscriptions")
        .select("plan, status, current_period_end, cancel_at_period_end, stripe_customer_id")
        .eq("user_id", id)
        .maybeSingle(),
      admin
        .from("company_members")
        .select(
          "company_id, role, title, joined_at, company:companies(public_id, name, entity_type, state_code)",
        )
        .eq("user_id", id),
      admin
        .from("admin_actions")
        .select("action, reason, metadata, created_at")
        .eq("target_user_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  if (!profile) notFound();

  const isForeverAdmin = await (async () => {
    if (!profile.email) return false;
    const { data } = await admin
      .from("super_admins")
      .select("email")
      .eq("email", profile.email.toLowerCase())
      .maybeSingle();
    return !!data;
  })();

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={adminUser.email ?? undefined} homeHref="/" />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <Link
          href="/"
          className="text-sm text-ink-soft hover:text-forest-800"
        >
          &larr; Admin
        </Link>

        <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              User
            </div>
            <h1 className="display mt-1 text-3xl text-forest-900">
              {profile.full_name ?? profile.email}
            </h1>
            <div className="text-sm text-ink-muted">
              {profile.email} - {profile.public_id}
            </div>
          </div>
          {isForeverAdmin ? (
            <span className="text-[11px] uppercase tracking-wide bg-gold-50 border border-gold-300 text-gold-700 rounded px-2 py-1">
              Forever admin
            </span>
          ) : profile.is_blocked ? (
            <span className="text-[11px] uppercase tracking-wide bg-red-50 border border-red-200 text-red-700 rounded px-2 py-1">
              Blocked
            </span>
          ) : null}
        </div>

        <section className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <KV label="Joined" value={new Date(profile.created_at).toLocaleString()} />
          <KV
            label="GDPR consent"
            value={
              profile.gdpr_consented_at
                ? new Date(profile.gdpr_consented_at).toLocaleString()
                : "Not yet"
            }
          />
          <KV
            label="Plan"
            value={`${sub?.plan ?? "free"} - ${sub?.status ?? "active"}`}
          />
          <KV
            label="Current period ends"
            value={
              sub?.current_period_end
                ? new Date(sub.current_period_end).toLocaleDateString()
                : "-"
            }
          />
          {profile.is_blocked ? (
            <>
              <KV
                label="Blocked at"
                value={
                  profile.blocked_at
                    ? new Date(profile.blocked_at).toLocaleString()
                    : "-"
                }
              />
              <KV
                label="Reason"
                value={profile.blocked_reason ?? "-"}
              />
            </>
          ) : null}
        </section>

        <section className="mt-8">
          <h2 className="display text-xl text-forest-900">
            Memberships ({members?.length ?? 0})
          </h2>
          <ul className="mt-3 grid gap-2">
            {(members ?? []).map((m) => {
              const c = m.company as unknown as {
                public_id: string;
                name: string;
                entity_type: string | null;
                state_code: string | null;
              };
              return (
                <li
                  key={m.company_id}
                  className="card p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-forest-900 truncate">
                      {c?.name}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {c?.public_id} - {m.role}
                      {m.title ? ` - ${m.title}` : ""} -{" "}
                      {c?.entity_type ?? "-"}
                    </div>
                  </div>
                  <span className="text-[10px] text-ink-muted uppercase tracking-wide">
                    joined {new Date(m.joined_at).toLocaleDateString()}
                  </span>
                </li>
              );
            })}
            {(members ?? []).length === 0 ? (
              <li className="text-sm text-ink-muted">No memberships.</li>
            ) : null}
          </ul>
        </section>

        {!isForeverAdmin ? (
          <section className="mt-8 card p-6">
            <h2 className="display text-xl text-forest-900">
              Account access
            </h2>
            {profile.is_blocked ? (
              <form action={unblockUser} className="mt-4 flex gap-3 flex-wrap">
                <input type="hidden" name="user_id" value={profile.id} />
                <button className="btn-primary">Unblock account</button>
                <span className="text-xs text-ink-soft self-center">
                  Restoring access lets the user sign in again immediately.
                </span>
              </form>
            ) : (
              <form action={blockUser} className="mt-4 grid sm:grid-cols-[1fr_auto] gap-3 items-start">
                <input type="hidden" name="user_id" value={profile.id} />
                <input
                  name="reason"
                  type="text"
                  className="input"
                  placeholder="Reason (visible to admins only)"
                  maxLength={200}
                />
                <button className="btn-primary">Block account</button>
                <p className="sm:col-span-2 text-xs text-ink-muted -mt-1">
                  Blocked users are signed out and shown a suspended page on
                  every visit. Their data is preserved.
                </p>
              </form>
            )}
          </section>
        ) : null}

        {!isForeverAdmin && profile.id !== adminUser.id ? (
          <section
            className="mt-8 card p-6"
            style={{ borderColor: "#b91c1c33" }}
          >
            <h2 className="display text-xl" style={{ color: "#b91c1c" }}>
              Danger zone, delete account
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              Permanently removes this user from auth and cascades through
              every table that references them (profiles, company
              memberships, device tokens, etc.). The person will need to
              sign up afresh. This action cannot be undone.
            </p>
            <TypedConfirmDelete
              formAction={deleteUserHard}
              hiddenFields={{ user_id: profile.id }}
              inputName="confirm_email"
              requireText={profile.email ?? ""}
              label={`Type the user's email to confirm: ${profile.email ?? ""}`}
              placeholder="user@example.com"
              buttonText="Delete account permanently"
              destructiveCopy="No recycle bin, no restore, the row is gone the moment you click. Logged to admin_actions."
            />
          </section>
        ) : null}

        {(events?.length ?? 0) > 0 ? (
          <section className="mt-8 card p-6">
            <h2 className="display text-xl text-forest-900">
              Admin actions
            </h2>
            <ul className="mt-3 grid gap-2 text-sm">
              {(events ?? []).map((e, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 border-b border-forest-50 last:border-0 py-2"
                >
                  <span className="text-[10px] uppercase tracking-wide text-gold-700 min-w-28">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                  <div>
                    <div className="font-medium text-forest-900">
                      {e.action}
                    </div>
                    {e.reason ? (
                      <div className="text-xs text-ink-soft">{e.reason}</div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-[10px] uppercase tracking-wide text-gold-700">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-forest-900">{value}</div>
    </div>
  );
}
