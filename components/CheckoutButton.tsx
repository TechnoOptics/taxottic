"use client";

import { useState } from "react";

/**
 * Single button for any Stripe checkout (subscription tier OR credit
 * top-up pack). The endpoint figures out which mode based on the key.
 */
export function CheckoutButton({
  priceKey,
  label,
  variant = "primary",
}: {
  priceKey: string;
  label: string;
  variant?: "primary" | "ghost";
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price_key: priceKey }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Checkout failed");
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className={
          (variant === "primary" ? "btn-primary" : "btn-ghost") + " w-full"
        }
        onClick={go}
        disabled={pending}
      >
        {pending ? "…" : label}
      </button>
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
