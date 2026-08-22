"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth";
import { createSandboxExcludingClient } from "@/lib/hq/elevated-client";
import { runSecurityPulse } from "@/lib/security/pulse";

/**
 * Manual "Run Pulse Now" trigger from the HQ Security dashboard. Runs
 * every monitor, persists the snapshot, then invalidates the dashboard
 * cache so the new run shows up immediately. Returns void so it can be
 * passed straight into <form action>.
 */
export async function runPulseNowAction(): Promise<void> {
  const { user } = await requireSuperAdmin();
  const result = await runSecurityPulse();
  const admin = createSandboxExcludingClient();

  const { error } = await admin.from("security_pulse_runs").insert({
    score: result.score,
    status: result.status,
    results: result,
    run_by: user.id,
    source: "manual",
  });

  if (error) {
    console.error("[security-pulse] insert failed", error);
    throw new Error("Failed to persist security pulse run.");
  }

  revalidatePath("/admin/security");
}
