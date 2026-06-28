"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Freshness } from "@/lib/format/relative-time";

type Props = {
  publicId: string;
  /** Precomputed on the server (relativeTime) to avoid hydration drift. */
  label: string;
  level: Freshness;
  canSync: boolean;
};

const TONE: Record<Freshness, string> = {
  fresh: "border-forest-200 text-ink-soft",
  stale: "border-gold-300 bg-gold-50/40 text-gold-800",
  old: "border-amber-300 bg-amber-50/50 text-amber-900",
  never: "border-forest-200 text-ink-soft",
};

/**
 * Slim "bank data synced X ago · Sync now" status bar. Shown wherever the
 * numbers depend on synced data (e.g. the forecast) so stale data is
 * visible and refreshable without hunting for the banks page. Turns amber
 * when the last sync is getting old.
 */
export function SyncFreshness({ publicId, label, level, canSync }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function syncNow() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/banks/sync-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Sync failed");
      } else {
        setMsg(
          data.added > 0
            ? `${data.added} new transaction${data.added === 1 ? "" : "s"}`
            : "Up to date",
        );
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const stale = level === "stale" || level === "old";

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs ${TONE[level]}`}
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden>{stale ? "⚠" : "↻"}</span>
        Bank data synced <span className="font-medium">{label}</span>
        {stale ? " — your numbers may be behind." : ""}
      </span>
      <span className="flex items-center gap-3">
        {msg ? <span className="text-forest-600">{msg}</span> : null}
        {error ? <span className="text-red-700">{error}</span> : null}
        {canSync ? (
          <button
            type="button"
            onClick={syncNow}
            disabled={busy}
            className="underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
          >
            {busy ? "Syncing…" : "Sync now"}
          </button>
        ) : null}
        <Link
          href={`/c/${publicId}/banks`}
          className="underline underline-offset-2 hover:opacity-80"
        >
          Manage
        </Link>
      </span>
    </div>
  );
}
