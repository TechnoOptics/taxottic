import { requireUserWithAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { PasskeyRegisterButton } from "@/components/PasskeyRegisterButton";
import { WatchPairForm } from "@/components/WatchPairForm";
import { deletePasskey } from "./actions";
import { revokeWatchDevice } from "../actions";

export default async function SecuritySettingsPage() {
  const { supabase, admin, user } = await requireUserWithAdmin();

  const { data: passkeys } = await supabase
    .from("passkeys")
    .select("id, friendly_name, device_type, backed_up, last_used_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // Paired watches — moved here from /settings in May 2026 so all
  // device-linked credentials (passkeys, 2FA, watch tokens) live
  // under one "Sign-in and devices" roof. Service-role read because
  // watch_devices RLS is policyless by design (token-bearer auth +
  // service-role writes only); we explicitly scope to this user.
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
      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Security
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Sign-in and devices
        </h1>
        <p className="mt-2 text-sm text-ink-soft max-w-lg">
          Add a passkey on this device to sign in with Touch ID, Face ID,
          Windows Hello, or your Android fingerprint - no passwords, no codes.
        </p>

        <div className="card mt-8 p-6">
          <h2 className="display text-xl text-forest-900">
            Add a passkey
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            One-tap setup on this device. Use it next time to sign in instantly.
          </p>
          <div className="mt-4">
            <PasskeyRegisterButton />
          </div>
        </div>

        <div className="card mt-6 p-6">
          <h2 className="display text-xl text-forest-900">Your passkeys</h2>
          {passkeys && passkeys.length > 0 ? (
            <ul className="mt-4 grid gap-2">
              {passkeys.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-forest-100 bg-white/70 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-forest-900">
                      {p.friendly_name ?? "Passkey"}
                    </div>
                    <div className="text-xs text-ink-muted mt-0.5">
                      {p.device_type === "multiDevice"
                        ? "Synced across devices"
                        : "This device only"}
                      {" - added "}
                      {new Date(p.created_at).toLocaleDateString()}
                      {p.last_used_at
                        ? ` - last used ${new Date(p.last_used_at).toLocaleDateString()}`
                        : ""}
                    </div>
                  </div>
                  <form action={deletePasskey}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-xs text-ink-muted hover:text-red-700 px-2 py-1">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">
              No passkeys yet. Add one above.
            </p>
          )}
        </div>

        {/* Wear OS pairing — lives here with the other device-linked
            credentials. Moved from /settings in May 2026 so the
            mental model is "Sign-in and devices = anything that
            authenticates as you on a piece of hardware". */}
        <div className="card mt-6 p-6">
          <h2 className="display text-xl text-forest-900">Pair your watch</h2>
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
        </div>

        <p className="mt-8 text-[11px] leading-relaxed text-ink-muted">
          Passkeys never leave your device unencrypted. The server only stores
          your public key, which alone cannot sign you in.
        </p>
      </section>
    </main>
  );
}
