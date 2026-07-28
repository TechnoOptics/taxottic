"use client";

import { useState, useTransition } from "react";
import {
  applySyncedTransaction,
  dismissSyncedTransaction,
} from "@/app/c/[publicId]/banks/actions";

type Category = { code: string; label: string };

/**
 * Resolve a pending synced transaction in place.
 *
 * The outstanding-task list counts these rows and links here, but until
 * now the page could only DISPLAY them — the app's categorize actions
 * work on the CSV-import table, not on synced Plaid/Stripe rows. So a
 * Stripe charge the auto-apply couldn't classify became a permanent,
 * uncloseable action item.
 *
 * Income vs expense is decided by the amount's sign, matching the sync
 * writers (positive cents = money out), so the picker only ever offers
 * the categories that make sense for the direction.
 */
export function ResolveSyncedTx({
  publicId,
  txId,
  amountCents,
  expenseCategories,
  incomeSources,
}: {
  publicId: string;
  txId: string;
  amountCents: number;
  expenseCategories: Category[];
  incomeSources: Category[];
}) {
  const isExpense = amountCents >= 0;
  const options = isExpense ? expenseCategories : incomeSources;
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        aria-label={isExpense ? "Expense category" : "Income source"}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        disabled={pending}
        className="input text-xs py-1 px-2 max-w-[16rem]"
      >
        <option value="">
          {isExpense ? "Pick a category…" : "Pick an income source…"}
        </option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        disabled={!code || pending}
        onClick={() =>
          startTransition(() => {
            const fd = new FormData();
            fd.set("publicId", publicId);
            fd.set("txId", txId);
            fd.set("categoryCode", code);
            void applySyncedTransaction(fd);
          })
        }
        className="btn-primary text-xs py-1 px-3 disabled:opacity-50"
      >
        {pending ? "Saving…" : isExpense ? "Add as expense" : "Add as income"}
      </button>

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(() => {
            const fd = new FormData();
            fd.set("publicId", publicId);
            fd.set("txId", txId);
            void dismissSyncedTransaction(fd);
          })
        }
        className="btn-ghost text-xs py-1 px-2 disabled:opacity-50"
      >
        Not business
      </button>
    </div>
  );
}
