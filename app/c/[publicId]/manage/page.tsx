import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import {
  inviteMember,
  readAndClearLastInviteLink,
  removeMember,
  revokeInvite,
} from "./actions";
import { closeCompany } from "@/app/actions/recycle-bin";
import { CopyInviteLink } from "@/components/CopyInviteLink";

type Params = Promise<{ publicId: string }>;

export default async function ManageCompanyPage({
  params,
}: {
  params: Params;
}) {
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
    .select(
      "user_id, role, title, joined_at, profile:profiles(public_id, email, full_name)",
    )
    .eq("company_id", company.id);

  const { data: invites } = await supabase
    .from("invitations")
    .select(
      "id, email, role, full_name, title, created_at, expires_at, accepted_at",
    )
    .eq("company_id", company.id)
    .is("accepted_at", null);

  const myRole = members?.find((m) => m.user_id === user.id)?.role;
  const isManager = myRole === "manager";

  // One-shot: was an invite just created? If so, fetch the share link
  // from the cookie set by the action so we can render a copy card.
  const lastInviteLink = isManager ? await readAndClearLastInviteLink() : null;

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.public_id} <span className="text-gold-500">·</span> Team
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          {company.name}
        </h1>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="team" />
        </div>

        {/* If we just created an invite, show a one-time copy-link card. */}
        {lastInviteLink ? (
          <section className="mt-6 card p-6 border-gold-300/60 bg-cream/60">
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              Invitation ready
            </div>
            <h2 className="display mt-1 text-xl text-forest-900">
              Share the welcome link.
            </h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              We saved the invitation. Send this link to your new teammate via
              email, text, or whatever they actually open. They'll sign in with
              the email you specified and join the team automatically.
            </p>
            <CopyInviteLink url={lastInviteLink} />
          </section>
        ) : null}

        {/* Role chip so the user can confirm at a glance whether they
            have the manager rights needed to invite teammates. */}
        <div className="mt-6 flex items-center gap-2 text-xs">
          <span
            className={
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 " +
              (isManager
                ? "bg-forest-800 text-cream"
                : "bg-cream/70 border border-forest-100 text-ink-soft")
            }
          >
            <span
              className={
                "size-1.5 rounded-full " +
                (isManager ? "bg-gold-300" : "bg-ink-muted")
              }
            />
            {isManager
              ? "You are the manager of this company"
              : "You are a member of this company"}
          </span>
        </div>

        {/* Add Employee section: rendered at the TOP of the team page so
            it's the first thing managers see. For non-managers we still
            show the section header with a friendly note explaining who
            can invite, instead of hiding it entirely (which made people
            think the feature didn't exist). */}
        <section
          id="add-employee"
          className="mt-6 card p-7 border-gold-300/60"
        >
          <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
            Add an employee
          </div>
          <h2 className="display mt-1 text-2xl text-forest-900">
            Bring someone onto the team.
          </h2>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-prose">
            Tell us about your new hire. We'll generate a private welcome
            link you can share. They sign in with the email you specify and
            are added to the team automatically; their job title and name
            come pre-filled.
          </p>

          {isManager ? (
            <form action={inviteMember} className="mt-5 grid gap-4">
              <input type="hidden" name="company_id" value={company.id} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Full name (optional)">
                  <input
                    name="full_name"
                    type="text"
                    placeholder="e.g. Jordan Rivera"
                    className="input"
                  />
                </Field>
                <Field label="Job title (optional)">
                  <input
                    name="title"
                    type="text"
                    placeholder="e.g. Lead photographer"
                    className="input"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Work email">
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="employee@email.com"
                    className="input"
                  />
                </Field>
                <Field label="Access level">
                  <select
                    name="role"
                    className="input"
                    defaultValue="member"
                  >
                    <option value="member">Member - sees forecasts, logs</option>
                    <option value="manager">Manager - can edit + invite</option>
                  </select>
                </Field>
              </div>

              <Field label="Personal welcome message (optional)">
                <textarea
                  name="personal_message"
                  rows={3}
                  className="input py-2"
                  placeholder={`Welcome aboard! We're glad you're here. Use this link to get set up. - ${user.email ?? "your manager"}`}
                />
              </Field>

              <label className="flex items-start gap-2 text-xs text-ink-soft cursor-pointer">
                <input
                  type="checkbox"
                  name="allow_bump_headcount"
                  className="mt-0.5 size-3.5 accent-forest-800"
                />
                <span>
                  If this invite exceeds my declared employee count, raise the
                  headcount on the business profile automatically.
                </span>
              </label>

              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                <button className="btn-primary">Create welcome link</button>
                <p className="text-xs text-ink-muted self-center">
                  Link expires in 14 days.
                </p>
              </div>
            </form>
          ) : (
            <div className="mt-5 rounded-lg border border-forest-100 bg-cream/40 px-4 py-3 text-sm text-ink-soft">
              Only the company manager can invite teammates. Ask a manager
              of <span className="font-medium text-forest-800">{company.name}</span>{" "}
              to send the welcome link, or upgrade your role with their help.
            </div>
          )}

          {isManager && invites && invites.length > 0 ? (
            <div className="mt-7">
              <h3 className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
                Pending invitations
              </h3>
              <ul className="mt-3 grid gap-2">
                {invites.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center justify-between rounded-lg border border-forest-100 bg-white/60 px-4 py-3 text-sm"
                  >
                    <div>
                      <div className="text-forest-900">
                        {i.full_name
                          ? `${i.full_name} · ${i.email}`
                          : i.email}
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5">
                        {[
                          i.title,
                          prettyRole(i.role),
                          `expires ${new Date(i.expires_at).toLocaleDateString()}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
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

        {/* Close company — manager-only "danger zone" at the bottom
            of the manage page. Soft-delete; the company moves to
            /settings/recycle-bin for 30 days. The user can Restore in
            one click during that window, or Permanently delete from
            the recycle bin (which cascades to every dependent row).
            We surface this on /manage rather than /profile or /settings
            because /manage is where a user goes when they're already
            thinking "what's the state of this company". */}
        {isManager ? (
          <section className="mt-6 card p-7 border-red-200/60 bg-red-50/30">
            <div className="text-[10px] uppercase tracking-[0.32em] text-red-700 font-medium">
              Close this company
            </div>
            <h2 className="display mt-1 text-xl text-forest-900">
              Move {company.name} to the recycle bin.
            </h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-prose">
              The company disappears from your dashboard and from every
              firm/portfolio view right away. Bank connections stay
              attached during the grace window in case you change your
              mind. After 30 days, the company and everything inside it
              — bank connections, transactions, monthly entries, business
              profile — is permanently deleted and cannot be recovered.
            </p>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-prose">
              Want a copy of the data first?{" "}
              <a
                href="/settings/data"
                className="underline hover:text-forest-900"
              >
                Download my data
              </a>{" "}
              gives you a JSON export including everything you&apos;ve
              entered for this company.
            </p>
            <form action={closeCompany} className="mt-4">
              <input type="hidden" name="company_id" value={company.id} />
              <button
                type="submit"
                className="inline-flex items-center justify-center h-10 px-4 rounded-[0.625rem] border border-red-300 bg-white text-sm text-red-700 hover:bg-red-50 transition-colors"
              >
                Move to recycle bin
              </button>
            </form>
          </section>
        ) : null}

        {/* Existing team roster, now BELOW the add-employee section */}
        <section className="mt-6 card p-7">
          <h2 className="display text-xl text-forest-900">Current team</h2>
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
                      {[
                        m.title,
                        prettyRole(m.role),
                        profile?.public_id,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  {isManager && m.user_id !== user.id ? (
                    <form action={removeMember}>
                      <input
                        type="hidden"
                        name="company_id"
                        value={company.id}
                      />
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
      </section>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-forest-800">{label}</span>
      {children}
    </label>
  );
}

function prettyRole(role: string | null | undefined): string {
  if (role === "manager") return "Manager";
  if (role === "member") return "Member";
  return role ?? "";
}
