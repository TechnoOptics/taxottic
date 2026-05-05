"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { setAutoTopUp } from "@/lib/plans/credits";
import { type CreditPackKey } from "@/lib/plans/limits";

const VALID_PACKS = new Set<CreditPackKey>([
  "boost",
  "stack",
  "bundle",
  "power",
]);

/**
 * Toggle auto-top-up. Fields:
 *   pack:      one of the pack keys, or "" to disable
 *   threshold: balance below which we auto-buy (clamped 1..1000; ignored when disabled)
 */
export async function setAutoTopUpAction(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const rawPack = String(formData.get("pack") ?? "");
  const rawThreshold = Number(formData.get("threshold") ?? 0);

  const pack: CreditPackKey | null = VALID_PACKS.has(rawPack as CreditPackKey)
    ? (rawPack as CreditPackKey)
    : null;
  const threshold =
    pack && Number.isFinite(rawThreshold)
      ? Math.max(1, Math.min(1000, Math.round(rawThreshold)))
      : null;

  await setAutoTopUp(admin, user.id, pack, threshold);
  revalidatePath("/billing");
}
