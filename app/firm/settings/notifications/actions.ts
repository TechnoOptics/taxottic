"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";

const VALID_CADENCES = new Set(["off", "daily", "weekly"]);

export async function updateNotificationPrefs(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const cadenceRaw = String(formData.get("digest_cadence") ?? "daily");
  const digest_cadence = VALID_CADENCES.has(cadenceRaw)
    ? cadenceRaw
    : "daily";
  const hourRaw = Number(formData.get("digest_hour_utc"));
  const digest_hour_utc =
    Number.isFinite(hourRaw) && hourRaw >= 0 && hourRaw <= 23
      ? Math.floor(hourRaw)
      : 13;

  // Excluded kinds come in as a comma-separated hidden field that
  // the form rebuilds from the unchecked checkboxes (the included
  // ones come in as `kind_*` fields; we invert).
  const excluded_kinds: string[] = [];
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("exclude:") && v === "on") {
      excluded_kinds.push(k.slice("exclude:".length));
    }
  }

  await admin
    .from("firm_notification_preferences")
    .upsert(
      {
        user_id: user.id,
        firm_id: ctx.firm.id,
        digest_cadence,
        digest_hour_utc,
        excluded_kinds,
      },
      { onConflict: "user_id,firm_id" },
    );

  revalidatePath("/firm/settings/notifications");
}
