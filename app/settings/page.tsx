import Link from "next/link";
import { requireUserWithAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import {
  setActivePlatform,
  setShowSmartSearch,
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
    .select("active_platform, full_name, show_smart_search")
    .eq("id", user.id)
    .maybeSingle();

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
      </section>
    </main>
  );
}
