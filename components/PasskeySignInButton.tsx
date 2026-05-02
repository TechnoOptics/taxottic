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
      // Common when the user has not yet registered a passkey on this
      // device, or the device-stored credential isn't a resident-key
      // (older registrations made before we required residentKey =
      // "required"), or the email hint doesn't match any passkey.
      const lower = message.toLowerCase();
      if (
        lower.includes("no credentials") ||
        lower.includes("not found") ||
        lower.includes("no passkey") ||
        lower.includes("no data") ||
        lower.includes("no available") ||
        lower.includes("operation either timed out")
      ) {
        setError(
          emailHint
            ? "No passkey for that email on this device. If you registered before today, sign in with your magic link first then re-add the passkey under Settings → Security - we now save resident-key passkeys that work without typing your email."
            : "No passkey saved on this device yet, or your existing passkey isn't discoverable. Type your email above first and try again, or sign in with the magic link below and re-add a passkey under Settings → Security.",
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
