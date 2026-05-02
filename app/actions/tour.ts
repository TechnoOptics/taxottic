"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";

/**
 * Mark the welcome tour as completed for the current user. Either
 * called when they finish the last step or click "skip". Writing the
 * timestamp guarantees the tour never shows again, even if they hit
 * the dashboard from a different device.
 */
export async function completeWelcomeTour() {
  const { admin, user } = await requireUserWithAdmin();
  await admin
    .from("profiles")
    .update({ tour_completed_at: new Date().toISOString() })
    .eq("id", user.id);
  revalidatePath("/dashboard");
}
