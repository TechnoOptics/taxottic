"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  connectionId: string;
};

/**
 * Mirror of PlaidSyncButton but pointed at /api/banks/stripe/sync.
 * Two separate buttons (rather than one polymorphic one) keeps each
 * connection card unambiguous and lets us evolve the two routes
 * independently, Stripe sync is balance-transaction cursor based
 * vs Plaid's transactions/sync, so the result shapes diverge.
 */
export function StripeSyncButton({ connectionId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/banks/stripe/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Sync failed");
      } else {
        const parts: string[] = [];
        if (data.added) parts.push(`${data.added} new`);
        if (data.skipped) parts.push("already synced this month");
        setResult(parts.length ? parts.join(", ") : "Up to date");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="text-xs text-forest-700 hover:text-forest-900 underline underline-offset-2 disabled:opacity-50"
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
      {result ? (
        <span className="text-[11px] text-forest-600">{result}</span>
      ) : null}
      {error ? (
        <span className="text-[11px] text-red-700">{error}</span>
      ) : null}
    </span>
  );
}
