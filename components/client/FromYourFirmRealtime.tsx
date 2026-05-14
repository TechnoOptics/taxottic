"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// FromYourFirmRealtime — sister to components/firm/ActivityList.
// Subscribes to firm_documents / firm_meetings / firm_invoices
// INSERTs + UPDATEs scoped to the engagement, and triggers
// `router.refresh()` on each change so the server-rendered
// FromYourFirmPanel re-fetches with the new data.
//
// We deliberately call `router.refresh()` instead of mutating local
// state because the panel is server-rendered (it reads from the
// service-role client to dodge RLS edge cases). Refreshing is
// cheaper to maintain than mirroring three Supabase tables on the
// client.

export function FromYourFirmRealtime({
  companyId,
  engagementIds,
}: {
  companyId: string;
  engagementIds: string[];
}) {
  const router = useRouter();

  useEffect(() => {
    if (engagementIds.length === 0) return;
    const supabase = createClient();
    const channel = supabase.channel(`from-firm:${companyId}`);

    for (const engId of engagementIds) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "firm_documents",
          filter: `engagement_id=eq.${engId}`,
        },
        () => router.refresh(),
      );
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "firm_meetings",
          filter: `engagement_id=eq.${engId}`,
        },
        () => router.refresh(),
      );
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "firm_invoices",
          filter: `engagement_id=eq.${engId}`,
        },
        () => router.refresh(),
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, engagementIds.join(","), router]);

  return null;
}
