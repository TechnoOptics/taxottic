import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { PasskeyRegisterButton } from "@/components/PasskeyRegisterButton";
import { deletePasskey } from "./actions";

export default async function SecuritySettingsPage() {
  const { supabase, user } = await requireUser();

  const { data: passkeys } = await supabase
    .from("passkeys")
    .select("id, friendly_name, device_type, backed_up, last_used_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

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

        <p className="mt-8 text-[11px] leading-relaxed text-ink-muted">
          Passkeys never leave your device unencrypted. The server only stores
          your public key, which alone cannot sign you in.
        </p>
      </section>
    </main>
  );
}
