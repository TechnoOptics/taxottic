"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";

type Props = {
  emailHint?: string;
};

export function PasskeySignInButton({ emailHint }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setError(null);
    setPending(true);
    try {
      const optsRes = await fetch("/api/passkeys/auth/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailHint }),
      });
      if (!optsRes.ok) {
        const e = await optsRes.json().catch(() => ({}));
        throw new Error(e.error ?? "Could not start sign-in");
      }
      const options = await optsRes.json();

      const assertion = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/passkeys/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertion),
      });
      if (!verifyRes.ok) {
        const e = await verifyRes.json().catch(() => ({}));
        throw new Error(e.error ?? "Sign-in failed");
      }
      const { redirect_url } = await verifyRes.json();
      if (redirect_url) {
        window.location.href = redirect_url;
      }
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") return;
      const message = err instanceof Error ? err.message : "Unknown error";
      // Common when the user has not yet registered a passkey on this device
      // or the email hint matches no passkeys at all.
      if (
        message.toLowerCase().includes("no credentials") ||
        message.toLowerCase().includes("not found") ||
        message.toLowerCase().includes("no passkey")
      ) {
        setError(
          "No passkey saved on this device yet. Sign in another way, then add a passkey under Settings → Security so it works next time.",
        );
      } else {
        setError(message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        className="btn-ghost w-full"
        onClick={signIn}
        disabled={pending}
      >
        {pending ? "..." : "Sign in with passkey"}
      </button>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </div>
  );
}
