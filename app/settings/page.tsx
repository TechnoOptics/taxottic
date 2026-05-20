import Link from "next/link";
import { requireUserWithAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { WatchPairForm } from "@/components/WatchPairForm";
import { revokeWatchDevice, setActivePlatform } from "./actions";

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
    .select("active_platform, full_name")
    .eq("id", user.id)
    .maybeSingle();

  const current = (profile?.active_platform as string | null) ?? "user";

  // Paired watches. RLS on watch_devices is policyless by design
  // (token-bearer auth + service-role writes only), so we read via
  // the service client and explicitly scope by user_id. Newest first;
  // already-revoked rows are filtered out.
  const { data: watches } = await admin
    .from("watch_devices")
    .select("id, label, created_at, last_seen_at")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  const pairedWatches = (watches ?? []) as Array<{
    id: string;
    label: string | null;
    created_at: string;
    last_seen_at: string | null;
  }>;

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
            Pair your watch
          </h2>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">
            Open the Taxottic app on your Wear OS watch. It shows a
            six-digit code — type it below to link the watch to your
            account. Codes expire in about two minutes.
          </p>
          <div className="mt-5">
            <WatchPairForm />
          </div>

          {pairedWatches.length > 0 ? (
            <div className="mt-7 border-t border-forest-100 pt-5">
              <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
                Paired
              </div>
              <ul className="mt-3 grid gap-2">
                {pairedWatches.map((w) => {
                  const lastSeen = w.last_seen_at
                    ? new Date(w.last_seen_at).toLocaleString()
                    : null;
                  return (
                    <li
                      key={w.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-forest-100 bg-white px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-forest-900 font-medium truncate">
                          {w.label ?? "Wear OS watch"}
                        </div>
                        <div className="text-xs text-ink-muted mt-0.5">
                          {lastSeen
                            ? `Last seen ${lastSeen}`
                            : `Paired ${new Date(w.created_at).toLocaleDateString()}`}
                        </div>
                      </div>
                      <form action={revokeWatchDevice}>
                        <input type="hidden" name="deviceId" value={w.id} />
                        <button
                          type="submit"
                          className="text-xs text-red-700 hover:underline underline-offset-2"
                        >
                          Unpair
                        </button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
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
