"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";

export async function markReminderRead(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabase
    .from("reminders")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/reminders");
  revalidatePath("/dashboard");
}

export async function dismissReminder(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabase
    .from("reminders")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/reminders");
  revalidatePath("/dashboard");
}
