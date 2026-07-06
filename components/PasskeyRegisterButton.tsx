"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  startRegistration,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";

export function PasskeyRegisterButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = not yet determined (SSR / first paint); false = this runtime has no
  // WebAuthn (notably the Android/iOS Capacitor WebView, which doesn't expose
  // PublicKeyCredential), so passkeys genuinely can't be created here.
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window-only capability check, not available during SSR
    setSupported(browserSupportsWebAuthn());
  }, []);

  async function register() {
    setError(null);
    setPending(true);
    try {
      const optsRes = await fetch("/api/passkeys/register/options", {
        method: "POST",
      });
      if (!optsRes.ok) {
        const e = await optsRes.json().catch(() => ({}));
        throw new Error(e.error ?? "Could not start registration");
      }
      const options = await optsRes.json();

      const attResp = await startRegistration({ optionsJSON: options });

      const friendly = guessDeviceName();
      const verifyRes = await fetch("/api/passkeys/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...attResp, friendly_name: friendly }),
      });
      if (!verifyRes.ok) {
        const e = await verifyRes.json().catch(() => ({}));
        throw new Error(e.error ?? "Verification failed");
      }
      router.refresh();
    } catch (err) {
      // User cancellation throws a NotAllowedError; treat as silent dismissal.
      if (err instanceof Error && err.name === "NotAllowedError") return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPending(false);
    }
  }

  // No WebAuthn here (the installed app's WebView): explain calmly and point at
  // the methods that DO work in the app, instead of a red "not supported" error.
  if (supported === false) {
    return (
      <p className="text-sm text-ink-soft leading-relaxed max-w-sm">
        Passkeys can only be added from a web browser. To create one, open{" "}
        <span className="font-medium text-forest-900">taxottic.com</span> in
        Chrome or Safari and add it there. In the app, sign in with a magic link
        or a 6-digit email code, which are just as quick.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="btn-primary"
        onClick={register}
        disabled={pending}
      >
        {pending ? "..." : "Add a passkey"}
      </button>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </div>
  );
}

function guessDeviceName(): string {
  if (typeof window === "undefined") return "Passkey";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "iPhone / iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Win/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "Browser";
}
