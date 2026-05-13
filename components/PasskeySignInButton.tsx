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
        aria-label="Sign in with passkey — Face ID, Touch ID, Windows Hello, or device PIN"
      >
        {/* Fingerprint/biometric glyph so users recognize this as the
            "use my device's unlock" option, not an abstract security
            concept they don't have. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M5.3 8.4A8 8 0 0 1 19 12v1.5" />
          <path d="M2.5 11.6a10.5 10.5 0 0 1 18.7-3.4" />
          <path d="M8.5 11.5a3.5 3.5 0 0 1 6.8-1" />
          <path d="M12 11.5v3a5 5 0 0 1-2.3 4.2" />
          <path d="M14.6 14.5a8.5 8.5 0 0 1-3.5 5.6" />
          <path d="M17.2 14.5v.5a11 11 0 0 1-1.6 5.8" />
        </svg>
        <span>{pending ? "Verifying..." : "Sign in with passkey"}</span>
      </button>
      <p className="text-[11px] text-ink-muted text-center leading-relaxed">
        Uses Face ID, Touch ID, Windows Hello, or your device PIN.
        No password to remember.
      </p>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </div>
  );
}
