"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  connectionId: string;
};

/**
 * "Sync now" button for a single bank_connection. Calls our sync
 * route which pulls fresh transactions from Plaid AND applies any
 * unprocessed posted transactions into monthly_income /
 * monthly_expenses, refreshing the forecast.
 *
 * Renders a tiny inline state instead of a toast because the connection
 * card is the natural place to read sync feedback.
 */
export function PlaidSyncButton({ connectionId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick(e: React.MouseEvent) {
    // Inside a <details><summary>, clicking would otherwise toggle
    // the accordion. Stop propagation so the card stays in whatever
    // state the user had it.
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/banks/plaid/sync", {
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
        if (data.modified) parts.push(`${data.modified} updated`);
        if (data.removed) parts.push(`${data.removed} removed`);
        if (data.applied) parts.push(`${data.applied} applied`);
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
        {busy ? "Syncing..." : "Sync now"}
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
