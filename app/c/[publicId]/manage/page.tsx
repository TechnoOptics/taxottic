import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { inviteMember, removeMember, revokeInvite } from "./actions";

type Params = Promise<{ publicId: string }>;

export default async function ManageCompanyPage({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user } = await requireUser();

  const { data: company } = await supabase
    .from("companies")
    .select("id, public_id, name, entity_type, state_code")
    .eq("public_id", publicId)
    .single();

  if (!company) notFound();

  const { data: members } = await supabase
    .from("company_members")
    .select("user_id, role, joined_at, profile:profiles(public_id, email, full_name)")
    .eq("company_id", company.id);

  const { data: invites } = await supabase
    .from("invitations")
    .select("id, email, role, created_at, expires_at, accepted_at")
    .eq("company_id", company.id)
    .is("accepted_at", null);

  const myRole = members?.find((m) => m.user_id === user.id)?.role;
  const isManager = myRole === "manager";

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          {company.public_id}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          {company.name}
        </h1>
        <div className="text-xs text-ink-muted mt-1 tracking-wide">
          Team
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="team" />
        </div>

        <section className="mt-6 card p-7">
          <h2 className="display text-xl text-forest-900">Members</h2>
          <ul className="mt-4 grid gap-2">
            {members?.map((m) => {
              const profile = m.profile as unknown as {
                public_id: string;
                email: string;
                full_name: string | null;
              };
              return (
                <li
                  key={m.user_id}
                  className="flex items-center justify-between rounded-lg border border-forest-100 bg-white/60 px-4 py-3 text-sm"
                >
                  <div>
                    <div className="font-medium text-forest-900">
                      {profile?.full_name ?? profile?.email}
                    </div>
                    <div className="text-xs text-ink-muted mt-0.5">
                      {profile?.public_id} - {m.role}
                    </div>
                  </div>
                  {isManager && m.user_id !== user.id ? (
                    <form action={removeMember}>
                      <input type="hidden" name="company_id" value={company.id} />
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <button className="text-xs text-red-700 hover:text-red-900">
                        Remove
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        {isManager ? (
          <section className="mt-6 card p-7">
            <h2 className="display text-xl text-forest-900">
              Invite an employee
            </h2>
            <form
              action={inviteMember}
              className="mt-4 flex flex-col sm:flex-row gap-2"
            >
              <input type="hidden" name="company_id" value={company.id} />
              <input
                name="email"
                type="email"
                required
                placeholder="employee@email.com"
                className="input flex-1"
              />
              <select name="role" className="input sm:w-40" defaultValue="member">
                <option value="member">Member</option>
                <option value="manager">Manager</option>
              </select>
              <button className="btn-primary">Invite</button>
            </form>

            {invites && invites.length > 0 ? (
              <div className="mt-7">
                <h3 className="text-xs uppercase tracking-[0.2em] text-gold-700">
                  Pending
                </h3>
                <ul className="mt-3 grid gap-2">
                  {invites.map((i) => (
                    <li
                      key={i.id}
                      className="flex items-center justify-between rounded-lg border border-forest-100 bg-white/60 px-4 py-3 text-sm"
                    >
                      <div>
                        <div className="text-forest-900">{i.email}</div>
                        <div className="text-xs text-ink-muted mt-0.5">
                          {i.role} - expires{" "}
                          {new Date(i.expires_at).toLocaleDateString()}
                        </div>
                      </div>
                      <form action={revokeInvite}>
                        <input type="hidden" name="invite_id" value={i.id} />
                        <button className="text-xs text-ink-soft hover:text-red-700">
                          Revoke
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}
      </section>
    </main>
  );
}
