"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";

const PLATFORMS = new Set(["user", "enterprise", "hq"]);
const PLATFORM_LANDING: Record<"user" | "enterprise" | "hq", string> = {
  user: "/dashboard",
  enterprise: "/admin/firms",
  hq: "/admin",
};

/**
 * Switch the active platform mode for the current user (super-admins
 * only). Saves the selection on profiles.active_platform and
 * redirects to the platform's landing page.
 */
export async function setActivePlatform(formData: FormData) {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const platform = String(formData.get("platform") ?? "user") as
    | "user"
    | "enterprise"
    | "hq";
  if (!PLATFORMS.has(platform)) {
    throw new Error("Invalid platform");
  }
  // Only super-admins can switch to non-user platforms. Regular users
  // can technically pick "user" but the toggle is a no-op for them.
  const { data: superAdmin } = await supabase.rpc("is_super_admin");
  if (!superAdmin && platform !== "user") {
    throw new Error("Forbidden");
  }
  await admin
    .from("profiles")
    .update({ active_platform: platform })
    .eq("id", user.id);
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  redirect(PLATFORM_LANDING[platform]);
}
