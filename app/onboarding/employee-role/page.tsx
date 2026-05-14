import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { saveEmployeeRole } from "./actions";

type Search = Promise<{ company_id?: string; next?: string }>;

export default async function EmployeeRolePage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const { admin, user } = await requireUserWithAdmin();
  const sp = await searchParams;
  const companyId = sp.company_id;
  const next = sp.next ?? "/dashboard";

  // If a company_id was passed, verify the user is actually a member of it.
  // Otherwise pick the most recent un-onboarded membership.
  let targetCompanyId: string | null = null;
  if (companyId) {
    const { data: m } = await admin
      .from("company_members")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (m) targetCompanyId = companyId;
  }
  if (!targetCompanyId) {
    const { data: m } = await admin
      .from("company_members")
      .select("company_id, joined_at, onboarded_at")
      .eq("user_id", user.id)
      .is("onboarded_at", null)
      .order("joined_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    targetCompanyId = m?.company_id ?? null;
  }

  if (!targetCompanyId) {
    redirect(next);
  }

  const { data: company } = await admin
    .from("companies")
    .select("name, public_id")
    .eq("id", targetCompanyId)
    .maybeSingle();
  if (!company) redirect(next);

  const { data: membership } = await admin
    .from("company_members")
    .select("role, title, bio")
    .eq("company_id", targetCompanyId)
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-lg mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="card p-5 sm:p-7 sm:p-8">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Welcome aboard
          </div>
          <h1 className="display mt-2 text-3xl text-forest-900">
            Welcome to {company.name}.
          </h1>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">
            Quick intro - tell your team what you do here. Both fields are
            optional and you can always edit later. Your access is{" "}
            <span className="font-medium text-forest-800">
              {membership?.role ?? "member"}
            </span>
            .
          </p>

          <form
            action={async (fd) => {
              "use server";
              await saveEmployeeRole(fd, next);
            }}
            className="mt-6 grid gap-5"
          >
            <input
              type="hidden"
              name="company_id"
              value={targetCompanyId}
            />
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Job title
              </span>
              <input
                name="title"
                type="text"
                className="input"
                defaultValue={membership?.title ?? ""}
                placeholder="e.g. Marketing Manager"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Short bio (optional)
              </span>
              <textarea
                name="bio"
                rows={3}
                className="input py-2"
                defaultValue={membership?.bio ?? ""}
                placeholder="What you focus on. One or two sentences."
              />
            </label>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button className="btn-primary">Continue</button>
              <a href={next} className="btn-ghost">
                Skip for now
              </a>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
