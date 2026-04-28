"use client";

import { useState } from "react";

export function CheckoutButton({
  priceKey,
}: {
  priceKey: "pro_monthly" | "pro_yearly";
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
        className="btn-primary w-full"
        onClick={go}
        disabled={pending}
      >
        {pending ? "..." : "Upgrade to Pro"}
      </button>
      {error ? (
        <p className="mt-2 text-xs text-red-700">{error}</p>
      ) : null}
    </div>
  );
}
