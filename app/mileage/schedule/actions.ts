"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import type { DayKey, MileageSchedule, Window } from "@/lib/mileage/schedule";
import { DAYS } from "@/lib/mileage/schedule";

/** Re-validate a posted "HH:MM" string. Mirrors lib/mileage/schedule
 *  but here at the server boundary so a malformed POST can't write a
 *  half-broken schedule that silently disables tracking. */
function validHm(hm: unknown): hm is string {
  if (typeof hm !== "string") return false;
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(hm.trim());
}

/**
 * Persist the mileage schedule from /mileage/schedule. The form
 * encodes the chosen mode + (depending on mode) either a single
 * from/to pair or per-day windows.
 */
export async function setMileageSchedule(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const mode = String(formData.get("mode") ?? "always");

  let schedule: MileageSchedule;

  if (mode === "always") {
    schedule = { mode: "always" };
  } else if (mode === "weekdays") {
    const from = String(formData.get("weekdays_from") ?? "09:00");
    const to = String(formData.get("weekdays_to") ?? "17:00");
    if (!validHm(from) || !validHm(to)) {
      schedule = { mode: "weekdays", from: "09:00", to: "17:00" };
    } else {
      schedule = { mode: "weekdays", from, to };
    }
  } else if (mode === "custom") {
    const windows: Record<DayKey, Window[]> = {
      mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [],
    };
    for (const d of DAYS) {
      const enabled = formData.get(`day_${d}`) === "on";
      if (!enabled) continue;
      const from = String(formData.get(`from_${d}`) ?? "");
      const to = String(formData.get(`to_${d}`) ?? "");
      if (!validHm(from) || !validHm(to)) continue;
      windows[d].push({ from, to });
    }
    schedule = { mode: "custom", windows };
  } else {
    // Unknown mode → safe default.
    schedule = { mode: "always" };
  }

  await admin
    .from("profiles")
    .update({ mileage_schedule: schedule })
    .eq("id", user.id);

  revalidatePath("/mileage/schedule");
  revalidatePath("/mileage");
  redirect("/mileage/schedule?saved=1");
}
