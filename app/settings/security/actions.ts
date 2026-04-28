"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";

export async function deletePasskey(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabase.from("passkeys").delete().eq("id", id);
  revalidatePath("/settings/security");
}
