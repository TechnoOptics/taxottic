"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Freshness } from "@/lib/format/relative-time";
import { RefreshIcon, WarningIcon } from "@/components/ui/Icons";

type Props = {
  publicId: string;
  /** Precomputed on the server (relativeTime) to avoid hydration drift. */
  label: string;
  level: Freshness;
  canSync: boolean;
};

const TONE: Record<Freshness, string> = {
  fresh: "border-forest-200 text-ink-soft",
  stale: "border-gold-400 text-gold-800",
  old: "border-amber-400 text-amber-900",
  never: "border-forest-200 text-ink-soft",
};

/**
 * Compact "synced X ago · Sync" pill, fixed in the top-right corner just
 * below the header. It's out of normal flow (position: fixed) so it never
 * pushes the page content down, and sits in the right gutter clear of the
 * sidebar. Turns amber when the last sync is getting old.
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
      role="status"
      title={
        stale
          ? "Your forecast may be behind your latest bank transactions."
          : `Bank data synced ${label}`
      }
      className={`fixed right-3 z-30 flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] shadow-sm bg-paper/95 dark:bg-forest-800/95 backdrop-blur ${TONE[level]}`}
      style={{
        top: "calc(max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)) + var(--app-header-h, 3.25rem) + 0.5rem)",
      }}
    >
      {stale ? (
        <WarningIcon className="size-3.5 shrink-0" />
      ) : (
        <RefreshIcon className="size-3.5 shrink-0" />
      )}
      <span>
        <span className="hidden sm:inline">Synced </span>
        <span className="font-medium">{label}</span>
      </span>
      {msg ? <span className="text-forest-600">· {msg}</span> : null}
      {error ? <span className="text-red-700">· {error}</span> : null}
      {canSync ? (
        <button
          type="button"
          onClick={syncNow}
          disabled={busy}
          className="underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
        >
          {busy ? "Syncing…" : "Sync"}
        </button>
      ) : null}
      <Link
        href={`/c/${publicId}/banks`}
        className="underline underline-offset-2 hover:opacity-80"
      >
        Manage
      </Link>
    </div>
  );
}
