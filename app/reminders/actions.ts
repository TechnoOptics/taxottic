"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";

export async function markReminderRead(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await admin
    .from("reminders")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  revalidatePath("/reminders");
  revalidatePath("/dashboard");
}

export async function dismissReminder(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await admin
    .from("reminders")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  revalidatePath("/reminders");
  revalidatePath("/dashboard");
}

// Bulk-dismiss every still-open overdue reminder for the current user.
// Wired to the dashboard recap card so the user can clear the
// "3 overdue reminders" banner in one click without drilling into
// /reminders (Round-2 audit Low: banner had no dismiss). Individual
// reminders can still be opened back up from /reminders by querying
// the dismissed-state filter, this only flips dismissed_at, never
// deletes.
export async function dismissAllOverdueReminders() {
  const { admin, user } = await requireUserWithAdmin();
  const nowIso = new Date().toISOString();
  await admin
    .from("reminders")
    .update({ dismissed_at: nowIso })
    .is("dismissed_at", null)
    .lt("due_at", nowIso)
    .eq("user_id", user.id);
  revalidatePath("/reminders");
  revalidatePath("/dashboard");
}
