import Link from "next/link";
import { requireUserWithAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { AvatarUploader } from "@/components/AvatarUploader";
import {
  setActivePlatform,
  setShowSmartSearch,
  setAvatarUrl,
  clearAvatarUrl,
  saveFullName,
  saveCompanyBio,
} from "./actions";

const PLATFORM_DESCRIPTION: Record<string, { label: string; body: string }> = {
  user: {
    label: "User",
    body: "Consumer dashboard — companies, forecast, expenses, Bella, savings playbook. The default for everyone.",
  },
  enterprise: {
    label: "Enterprise",
    body: "Firms operations — preparer center, client list, engagement workflow.",
  },
  hq: {
    label: "HQ",
    body: "Super-admin operations — security pulse, user management, feedback queue, firm onboarding.",
  },
};

export default async function SettingsPage() {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const { data: superAdmin } = await supabase.rpc("is_super_admin");

  const { data: profile } = await admin
    .from("profiles")
    .select("active_platform, full_name, avatar_url, show_smart_search")
    .eq("id", user.id)
    .maybeSingle();

  // For the per-company "message" (company_members.bio) — most users
  // belong to one company, but list every membership so nobody's
  // message is hidden just because they're on more than one team.
  const { data: memberships } = await admin
    .from("company_members")
    .select("bio, company:companies(id, public_id, name)")
    .eq("user_id", user.id);
  const bioMemberships = (memberships ?? [])
    .map((m) => {
      const company = Array.isArray(m.company) ? m.company[0] : m.company;
      return company
        ? { companyId: company.id, companyName: company.name, bio: m.bio as string | null }
        : null;
    })
    .filter((m): m is { companyId: string; companyName: string; bio: string | null } => m !== null);

  const current = (profile?.active_platform as string | null) ?? "user";
  const showSmartSearch = profile?.show_smart_search === true;
  // Note: watch pairing + paired-devices list moved to
  // /settings/security (May 2026). It sits with passkeys + 2FA under
  // "Sign-in and devices" — that's where users intuitively look for
  // device-linked credentials, and it kept this page focused on
  // platform + display preferences.

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Account
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">Settings</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Signed in as {profile?.full_name ?? user.email}.
        </p>

        <section className="card mt-8 p-6 sm:p-7">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Profile
          </div>
          <h2 className="display mt-1 text-xl text-forest-900">
            Photo &amp; name
          </h2>
          <div className="mt-4">
            <AvatarUploader
              userId={user.id}
              displayName={profile?.full_name ?? user.email ?? "You"}
              initialAvatarUrl={profile?.avatar_url ?? null}
              setAvatarAction={setAvatarUrl}
              clearAvatarAction={clearAvatarUrl}
            />
          </div>
          <form action={saveFullName} className="mt-5 flex flex-wrap gap-2">
            <input
              name="full_name"
              type="text"
              defaultValue={profile?.full_name ?? ""}
              placeholder="Your full name"
              className="input flex-1 min-w-[12rem]"
            />
            <button type="submit" className="btn-primary text-sm">
              Save name
            </button>
          </form>

          {bioMemberships.length > 0 ? (
            <div className="mt-6 grid gap-4">
              {bioMemberships.map((m) => (
                <div key={m.companyId}>
                  <label className="text-sm font-medium text-forest-800">
                    Message for {m.companyName}
                  </label>
                  <p className="text-xs text-ink-muted mt-0.5">
                    Shows to your manager and teammates on the roster — e.g.
                    your role, availability, or a short status.
                  </p>
                  <form
                    action={saveCompanyBio}
                    className="mt-2 grid gap-2"
                  >
                    <input type="hidden" name="company_id" value={m.companyId} />
                    <textarea
                      name="bio"
                      rows={2}
                      maxLength={280}
                      defaultValue={m.bio ?? ""}
                      placeholder="e.g. Lead photographer — usually out on shoots Tue/Thu"
                      className="input py-2"
                    />
                    <div>
                      <button type="submit" className="btn-ghost text-sm">
                        Save message
                      </button>
                    </div>
                  </form>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        {superAdmin ? (
          <section className="card mt-8 p-6 sm:p-7">
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              Platform
            </div>
            <h2 className="display mt-1 text-xl text-forest-900">
              Move between platforms
            </h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              You&apos;re a super-admin so you can hop between the consumer
              app, the firm/enterprise console, and the HQ super-admin
              operations panel. Selection is saved to your profile.
            </p>

            <form action={setActivePlatform} className="mt-5 grid gap-3">
              {(["user", "enterprise", "hq"] as const).map((p) => {
                const meta = PLATFORM_DESCRIPTION[p];
                const checked = current === p;
                return (
                  <label
                    key={p}
                    className={
                      "flex gap-3 p-4 rounded-xl border bg-white cursor-pointer hover:border-gold-300 " +
                      (checked
                        ? "border-gold-300 ring-1 ring-gold-200"
                        : "border-forest-100")
                    }
                  >
                    <input
                      type="radio"
                      name="platform"
                      value={p}
                      defaultChecked={checked}
                      className="mt-1 size-4 accent-forest-700"
                    />
                    <div className="min-w-0">
                      <div className="display text-base text-forest-900">
                        {meta.label}
                        {checked ? (
                          <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-gold-700 font-medium">
                            Current
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-ink-soft mt-1 leading-relaxed">
                        {meta.body}
                      </p>
                    </div>
                  </label>
                );
              })}
              <div>
                <button type="submit" className="btn-primary text-sm">
                  Switch platform
                </button>
              </div>
            </form>
          </section>
        ) : null}

        <section className="card mt-8 p-6 sm:p-7">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Header
          </div>
          <h2 className="display mt-1 text-xl text-forest-900">
            Smart search bar
          </h2>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">
            A Bella-powered search input pinned to the top of every page
            — ask anything about your business, deductions, or
            forecast and get an answer with citations. Off by default
            for a quieter header; flip it on when you want it.
          </p>
          <form action={setShowSmartSearch} className="mt-4 grid gap-3">
            <label className="inline-flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                name="show_smart_search"
                defaultChecked={showSmartSearch}
                className="size-4 accent-forest-700"
              />
              <span className="text-sm text-forest-800">
                Show the smart search bar in the header
              </span>
            </label>
            <p className="text-xs text-ink-muted">
              Visible on desktop widths (≥ 1024 px). On phones the
              header stays uncluttered either way — open Bella from
              the full chat page instead.
            </p>
            <div>
              <button type="submit" className="btn-primary text-sm">
                Save
              </button>
            </div>
          </form>
        </section>

        <section className="card mt-6 p-6 sm:p-7">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Security
          </div>
          <h2 className="display mt-1 text-xl text-forest-900">
            Passkeys + 2FA
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            Manage device passkeys and second-factor authentication.
          </p>
          <div className="mt-4">
            <Link href="/settings/security" className="btn-ghost text-sm">
              Open security settings
            </Link>
          </div>
        </section>

        <section className="card mt-6 p-6 sm:p-7">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Devices
          </div>
          <h2 className="display mt-1 text-xl text-forest-900">
            Pair a watch
          </h2>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">
            Watch pairing now lives under{" "}
            <Link
              href="/settings/security"
              className="text-gold-700 underline underline-offset-2 hover:text-gold-600"
            >
              Security → Sign-in and devices
            </Link>
            . You&apos;ll see your paired watches and the six-digit pairing
            form there.
          </p>
        </section>

        <section className="card mt-6 p-6 sm:p-7">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Billing
          </div>
          <h2 className="display mt-1 text-xl text-forest-900">
            Plan + credits
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            Change tier, top up credits, or update payment.
          </p>
          <div className="mt-4">
            <Link href="/billing" className="btn-ghost text-sm">
              Open billing
            </Link>
          </div>
        </section>

        <section className="card mt-6 p-6 sm:p-7">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Troubleshooting
          </div>
          <h2 className="display mt-1 text-xl text-forest-900">
            Device diagnostics
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            Something look misplaced on this device — content under the
            status bar, buttons behind system controls? This page reads
            the device&apos;s real layout numbers so support can fix it
            precisely.
          </p>
          <div className="mt-4">
            <Link href="/debug/device" className="btn-ghost text-sm">
              Open diagnostics
            </Link>
          </div>
        </section>
      </section>
    </main>
  );
}
