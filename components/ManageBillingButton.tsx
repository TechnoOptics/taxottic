"use client";

import { useState } from "react";
import { useIsNativeApp } from "@/components/MobileOnly";

// Hidden inside the native app (App Store Guideline 3.1.1): opening the
// Stripe billing portal is a purchase/management control, which can't
// appear in a non-IAP WebView app. Subscribers manage billing on the web.
export function ManageBillingButton() {
  const isNative = useIsNativeApp();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Portal unavailable");
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPending(false);
    }
  }

  if (isNative !== false) return null;

  return (
    <div>
      <button
        type="button"
        onClick={open}
        disabled={pending}
        className="btn-ghost"
      >
        {pending ? "..." : "Manage billing"}
      </button>
      {error ? (
        <p className="mt-2 text-xs text-red-700">{error}</p>
      ) : null}
    </div>
  );
}
