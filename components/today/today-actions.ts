"use server";

import { dismissSyncedTransaction } from "@/app/c/[publicId]/banks/actions";

/** The one in-place resolution Today offers: a synced transaction is not business. */
export async function notBusiness(formData: FormData): Promise<void> {
  await dismissSyncedTransaction(formData);
}
