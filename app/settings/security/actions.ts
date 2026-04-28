"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";

export async function deletePasskey(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await admin.from("passkeys").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/settings/security");
}
