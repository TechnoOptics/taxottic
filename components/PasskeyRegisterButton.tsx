"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";

export function PasskeyRegisterButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
