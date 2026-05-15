"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// ActivityList — client component that subscribes to firm_activity_log
// changes via Supabase Realtime. On mount it shows the server-rendered
// rows; any subsequent INSERT for the same firm gets prepended live.
// The page re-renders the initial slice on next navigation, so a
// long-running tab catches up properly without a hard refresh.

export type ActivityRow = {
  id: string;
  kind: string;
  summary: string | null;
  created_at: string;
  actor_side: string;
  company_id: string | null;
  engagement_id: string | null;
};

export function ActivityList({
  firmId,
  initialRows,
  limit = 50,
}: {
  firmId: string;
  initialRows: ActivityRow[];
  limit?: number;
}) {
  const [rows, setRows] = useState<ActivityRow[]>(initialRows);
  const [newSinceMount, setNewSinceMount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`firm-activity:${firmId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "firm_activity_log",
          filter: `firm_id=eq.${firmId}`,
        },
        (payload) => {
          const row = payload.new as ActivityRow;
          setRows((prev) => {
            // Dedupe by id in case a fast paint shows the row twice.
            if (prev.some((r) => r.id === row.id)) return prev;
            return [row, ...prev].slice(0, limit);
          });
          setNewSinceMount((n) => n + 1);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [firmId, limit]);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-ink-muted leading-relaxed">
        Nothing yet. Activity from clients, engagements, documents,
        scheduling, and payments will stream in here as it happens.
      </p>
    );
  }

  return (
    <div>
      {newSinceMount > 0 ? (
        <div className="mb-3 text-[11px] text-emerald-700 dark:text-emerald-300">
          {newSinceMount} new event{newSinceMount === 1 ? "" : "s"} since you
          opened the inbox.
        </div>
      ) : null}
      <ul className="grid gap-3 text-sm">
        {rows.map((r) => (
          <li
            key={r.id}
            className="rounded-lg border border-forest-100 bg-white/70 px-4 py-3 dark:bg-forest-900/40 dark:border-forest-700"
          >
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-forest-900 leading-snug dark:text-cream">
                  {r.summary ?? r.kind}
                </div>
                <div className="mt-0.5 text-[11px] text-ink-muted flex flex-wrap gap-x-2 gap-y-0.5">
                  <span className="font-medium text-gold-700 uppercase tracking-[0.12em]">
                    {r.kind.replace(/\./g, " · ")}
                  </span>
                  <span>·</span>
                  <span>{r.actor_side}</span>
                </div>
              </div>
              <span className="text-[11px] text-ink-muted whitespace-nowrap">
                {formatTime(r.created_at)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const ageMs = Date.now() - d.getTime();
  const ageMin = Math.floor(ageMs / 60_000);
  if (ageMin < 1) return "just now";
  if (ageMin < 60) return `${ageMin}m ago`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
