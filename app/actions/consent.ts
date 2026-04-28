"use server";

import { requireUserWithAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function recordGdprConsent() {
  const { admin, user } = await requireUserWithAdmin();
  await admin
    .from("profiles")
    .update({ gdpr_consented_at: new Date().toISOString() })
    .eq("id", user.id);
  revalidatePath("/dashboard");
}
