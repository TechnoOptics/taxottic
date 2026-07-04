import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";
import { inviteFirmMember, revokeInvitation, removeMember } from "./actions";

// /firm/settings/team, view + manage firm members and pending
// invitations. Two sections: active members table on top, pending
// invites below. Form on the right invites a new member.

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  preparer: "Preparer",
  reviewer: "Reviewer",
};
const ROLE_TONE: Record<string, string> = {
  owner: "bg-gold-50 text-gold-800 border-gold-200",
  manager: "bg-emerald-50 text-emerald-700 border-emerald-200",
  preparer: "bg-cream-200 text-forest-800 border-forest-200",
  reviewer: "bg-cream-100 text-ink-muted border-forest-100",
};

export default async function TeamSettingsPage() {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();

  const [{ data: membersRaw }, { data: invites }] = await Promise.all([
    admin
      .from("firm_members")
      .select(
        "user_id, role, title, joined_at, profiles!inner(email, full_name)",
      )
      .eq("firm_id", ctx.firm.id)
      .order("joined_at", { ascending: true }),
    admin
      .from("firm_invitations")
      .select("id, email, full_name, title, role, invited_by, expires_at, created_at")
      .eq("firm_id", ctx.firm.id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  type MemberRow = {
    user_id: string;
    role: string;
    title: string | null;
    joined_at: string;
    profiles: { email: string; full_name: string | null };
  };
  const members = (membersRaw ?? []) as unknown as MemberRow[];

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm/settings"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Settings
          </Link>{" "}
          · Team
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Your team.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-xl">
          Invite the rest of your firm. Preparers get assigned to
          engagements; reviewers sign off on preparer work; managers
          run the firm; owners can transfer ownership and configure
          billing.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_20rem]">
          <section>
            <h2 className="display text-xl text-forest-900">Members</h2>
            <ul className="mt-3 grid gap-3">
              {members.map((m) => {
                const isSelf = m.user_id === user.id;
                return (
                  <li key={m.user_id} className="card p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="display text-base text-forest-900">
                            {m.profiles.full_name?.trim() || m.profiles.email}
                          </span>
                          <span
                            className={
                              "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border " +
                              (ROLE_TONE[m.role] ?? "")
                            }
                          >
                            {ROLE_LABEL[m.role] ?? m.role}
                          </span>
                          {isSelf ? (
                            <span className="text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                              you
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-ink-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>{m.profiles.email}</span>
                          {m.title ? (
                            <>
                              <span>·</span>
                              <span>{m.title}</span>
                            </>
                          ) : null}
                          <span>·</span>
                          <span>
                            Joined{" "}
                            {new Intl.DateTimeFormat("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }).format(new Date(m.joined_at))}
                          </span>
                        </div>
                      </div>
                      {!isSelf ? (
                        <form action={removeMember}>
                          <input
                            type="hidden"
                            name="user_id"
                            value={m.user_id}
                          />
                          <button
                            type="submit"
                            className="btn-ghost text-xs px-3 h-9 hover:text-red-700"
                          >
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            {(invites ?? []).length > 0 ? (
              <>
                <h2 className="display text-xl text-forest-900 mt-8">
                  Pending invitations
                </h2>
                <ul className="mt-3 grid gap-2">
                  {(invites ?? []).map((i) => (
                    <li
                      key={i.id}
                      className="rounded-lg border border-forest-100 bg-white/70 px-4 py-3 text-sm flex items-center justify-between gap-3 flex-wrap"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-forest-900 truncate">
                          {i.full_name?.trim() || i.email}
                        </div>
                        <div className="text-xs text-ink-muted">
                          {i.email} · {ROLE_LABEL[i.role] ?? i.role}
                          {i.title ? ` · ${i.title}` : ""} · Expires{" "}
                          {new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                          }).format(new Date(i.expires_at))}
                        </div>
                      </div>
                      <form action={revokeInvitation}>
                        <input type="hidden" name="id" value={i.id} />
                        <button className="btn-ghost text-xs px-3 h-9 hover:text-red-700">
                          Revoke
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          {/* Invite form */}
          <aside>
            <form
              action={inviteFirmMember}
              className="card p-5 grid gap-3"
            >
              <h2 className="display text-base text-forest-900">
                Invite a team member
              </h2>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Email
                </span>
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="prep@yourfirm.com"
                  className="input text-sm"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Full name (optional)
                </span>
                <input
                  type="text"
                  name="full_name"
                  placeholder="Jordan Smith"
                  className="input text-sm"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Title (optional)
                </span>
                <input
                  type="text"
                  name="title"
                  placeholder="Senior CPA"
                  className="input text-sm"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Role
                </span>
                <select
                  name="role"
                  className="input text-sm"
                  defaultValue="preparer"
                >
                  <option value="preparer">Preparer</option>
                  <option value="reviewer">Reviewer</option>
                  <option value="manager">Manager</option>
                  {ctx.membership.role === "owner" ? (
                    <option value="owner">Owner</option>
                  ) : null}
                </select>
                <span className="text-[10px] text-ink-muted leading-relaxed">
                  Preparer = sees assigned engagements. Manager =
                  runs the firm. Owner = can transfer ownership.
                </span>
              </label>
              <button type="submit" className="btn-primary text-sm mt-1">
                Send invitation
              </button>
            </form>
          </aside>
        </div>
      </section>
    </main>
  );
}
