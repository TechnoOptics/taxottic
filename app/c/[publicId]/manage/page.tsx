import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { PageHeader } from "@/components/PageHeader";
import { formatCents } from "@/lib/tax/forecast";
import {
  inviteMember,
  readAndClearLastInviteLink,
  removeMember,
  revokeInvite,
  createDepartment,
  renameDepartment,
  deleteDepartment,
  assignMemberDepartment,
} from "./actions";
import { closeCompany } from "@/app/actions/recycle-bin";
import { CopyInviteLink } from "@/components/CopyInviteLink";
import { CustomSelect } from "@/components/CustomSelect";
import { TeamRoster, type RosterRow } from "@/components/TeamRoster";

type Params = Promise<{ publicId: string }>;

// This page is per-user and auth-gated (roster, role chip, invites). Never
// serve a cached render — a stale build/edge copy was showing an empty roster
// and mislabeling the manager as a plain "member".
export const dynamic = "force-dynamic";

export default async function ManageCompanyPage({
  params,
}: {
  params: Params;
}) {
  const { publicId } = await params;
  const { supabase, user } = await requireUser();

  const { data: company } = await supabase
    .from("companies")
    .select("id, public_id, name, entity_type, state_code, created_by")
    .eq("public_id", publicId)
    .single();

  if (!company) notFound();

  // The RLS-scoped `companies` read above is the access gate: only a member,
  // super-admin, or engaged firm reaches this point. The roster + invites are
  // then read with the service client so the listing never silently empties
  // out on an auth-context hiccup (the user-scoped read was returning zero
  // rows even for the manager, leaving the Team page blank).
  const admin = createServiceClient();

  // NOTE: company_members.user_id has NO foreign key to profiles (it points
  // at auth.users), so PostgREST cannot resolve an embedded
  // `profile:profiles(...)` select — that query errored and returned null,
  // which silently blanked the entire roster (and made the manager look like
  // a plain "member"). Fetch the member rows and their profiles separately,
  // then stitch them together by user_id.
  const { data: memberRows } = await admin
    .from("company_members")
    .select("user_id, role, title, joined_at, department_id, employee_number")
    .eq("company_id", company.id);

  const { data: departmentRows } = await admin
    .from("departments")
    .select("id, name")
    .eq("company_id", company.id)
    .order("name");
  const departments = departmentRows ?? [];
  const departmentById = new Map(departments.map((d) => [d.id, d.name]));

  type ProfileRow = {
    id: string;
    public_id: string;
    email: string;
    full_name: string | null;
  };
  const memberIds = (memberRows ?? []).map((m) => m.user_id);
  let profileRows: ProfileRow[] = [];
  if (memberIds.length) {
    const { data } = await admin
      .from("profiles")
      .select("id, public_id, email, full_name")
      .in("id", memberIds);
    profileRows = (data ?? []) as ProfileRow[];
  }
  const profileById = new Map(profileRows.map((p) => [p.id, p]));
  const members = (memberRows ?? []).map((m) => ({
    ...m,
    profile: profileById.get(m.user_id) ?? null,
  }));

  const { data: invites } = await admin
    .from("invitations")
    .select(
      "id, email, role, full_name, title, created_at, expires_at, accepted_at",
    )
    .eq("company_id", company.id)
    .is("accepted_at", null);

  const myRole = members?.find((m) => m.user_id === user.id)?.role;
  // The account creator is always treated as the manager (safety net so the
  // person who created the company can never be locked out of inviting
  // teammates), mirroring the server-side gate in isManagerOf.
  const isManager = myRole === "manager" || company.created_by === user.id;

  // One-shot: was an invite just created? If so, fetch the share link
  // from the cookie set by the action so we can render a copy card.
  const lastInviteLink = isManager ? await readAndClearLastInviteLink() : null;

  // Per-member financials so the roster doubles as a "who's expensing /
  // driving what" summary. Managers only. Mileage is BUSINESS-only — an
  // employee's personal + unclassified drives stay private, matching the
  // /mileage manager view.
  const taxYear = new Date().getUTCFullYear();
  let expRows: { user_id: string; amount_cents: number }[] = [];
  let tripRows: {
    driver_user_id: string;
    distance_miles: number;
    deduction_cents: number;
  }[] = [];
  if (isManager) {
    const [e, t] = await Promise.all([
      admin
        .from("monthly_expenses")
        .select("user_id, amount_cents")
        .eq("company_id", company.id)
        .eq("tax_year", taxYear),
      admin
        .from("mileage_trips")
        .select("driver_user_id, distance_miles, deduction_cents")
        .eq("company_id", company.id)
        .eq("classification", "business")
        .eq("tax_year", taxYear),
    ]);
    expRows = (e.data ?? []) as typeof expRows;
    tripRows = (t.data ?? []) as typeof tripRows;
  }
  const expenseByUser = new Map<string, number>();
  for (const r of expRows) {
    expenseByUser.set(
      r.user_id,
      (expenseByUser.get(r.user_id) ?? 0) + Number(r.amount_cents || 0),
    );
  }
  const mileageByUser = new Map<string, { miles: number; cents: number }>();
  for (const r of tripRows) {
    const cur = mileageByUser.get(r.driver_user_id) ?? { miles: 0, cents: 0 };
    cur.miles += Number(r.distance_miles || 0);
    cur.cents += Number(r.deduction_cents || 0);
    mileageByUser.set(r.driver_user_id, cur);
  }

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-10">
        <PageHeader eyebrow="Team" title={company.name} />

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
              email, text, or whatever they actually open. They&apos;ll sign in
              with the email you specified and join the team automatically.
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

        {/* Departments — manager-only, flat (no nesting). Rendered above
            Add an employee so a freshly-created department is already
            available in that form's department picker on the same page
            load (both sections share the `departments` array fetched
            above). */}
        {isManager ? (
          <section className="mt-6 card p-5 sm:p-7">
            <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
              Departments
            </div>
            <h2 className="display mt-1 text-xl text-forest-900">
              Group your team.
            </h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-prose">
              Departments are optional. Assign teammates to one so expenses
              and mileage show where they came from at a glance.
            </p>

            {departments.length > 0 ? (
              <ul className="mt-4 grid gap-2">
                {departments.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-forest-100 bg-white/60 px-4 py-2.5 text-sm"
                  >
                    <form
                      action={renameDepartment}
                      className="flex items-center gap-2 min-w-0 flex-1"
                    >
                      <input type="hidden" name="department_id" value={d.id} />
                      <input
                        name="name"
                        defaultValue={d.name}
                        className="input h-8 text-sm min-w-0"
                      />
                      <button className="text-xs text-gold-800 hover:text-gold-900 shrink-0">
                        Save
                      </button>
                    </form>
                    <form action={deleteDepartment}>
                      <input type="hidden" name="department_id" value={d.id} />
                      <button className="text-xs text-red-700 hover:text-red-900 shrink-0">
                        Delete
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : null}

            <form
              action={createDepartment}
              className="mt-4 flex flex-col sm:flex-row gap-2"
            >
              <input type="hidden" name="company_id" value={company.id} />
              <input
                name="name"
                required
                placeholder="e.g. Sales"
                className="input"
              />
              <button className="btn-ghost text-sm px-4 h-10 whitespace-nowrap">
                + Add department
              </button>
            </form>
          </section>
        ) : null}

        {/* Add Employee section: rendered at the TOP of the team page so
            it's the first thing managers see. For non-managers we still
            show the section header with a friendly note explaining who
            can invite, instead of hiding it entirely (which made people
            think the feature didn't exist). */}
        <section
          id="add-employee"
          className="mt-6 card p-5 sm:p-7 border-gold-300/60"
        >
          <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
            Add an employee
          </div>
          <h2 className="display mt-1 text-2xl text-forest-900">
            Bring someone onto the team.
          </h2>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-prose">
            Tell us about your new hire. We&apos;ll generate a private welcome
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
                  <CustomSelect
                    name="role"
                    defaultValue="member"
                    options={[
                      { value: "member", label: "Member - sees forecasts, logs" },
                      { value: "manager", label: "Manager - can edit + invite" },
                    ]}
                  />
                </Field>
              </div>

              {departments.length > 0 ? (
                <Field label="Department (optional)">
                  <CustomSelect
                    name="department_id"
                    defaultValue=""
                    options={[
                      { value: "", label: "No department" },
                      ...departments.map((d) => ({ value: d.id, label: d.name })),
                    ]}
                  />
                </Field>
              ) : null}

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
          <section className="mt-6 card p-5 sm:p-7 border-red-200/60 bg-red-50/30">
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
        <section className="mt-6 card p-5 sm:p-7">
          <h2 className="display text-xl text-forest-900">Current team</h2>
          <div className="mt-4">
            <TeamRoster
              members={(members ?? []).map((m): RosterRow => {
                const profile = m.profile as unknown as {
                  public_id: string;
                  email: string;
                  full_name: string | null;
                };
                return {
                  userId: m.user_id,
                  name: profile?.full_name ?? profile?.email ?? "Member",
                  email: profile?.email ?? "",
                  employeeNumber: m.employee_number,
                  title: m.title,
                  roleLabel: prettyRole(m.role),
                  departmentId: m.department_id,
                  departmentName: m.department_id
                    ? (departmentById.get(m.department_id) ?? null)
                    : null,
                  expenseLabel: formatCents(expenseByUser.get(m.user_id) ?? 0),
                  mileageLabel: `${(
                    mileageByUser.get(m.user_id)?.miles ?? 0
                  ).toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })} mi · ${formatCents(mileageByUser.get(m.user_id)?.cents ?? 0)}`,
                  isSelf: m.user_id === user.id,
                };
              })}
              departments={departments}
              companyId={company.id}
              publicId={publicId}
              isManager={isManager}
              assignMemberDepartment={assignMemberDepartment}
              removeMember={removeMember}
            />
          </div>
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
