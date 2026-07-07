"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type DeletableTx = {
  id: string;
  merchant: string;
  date: string; // ISO yyyy-mm-dd
  amountCents: number; // sign-encoded the same way the page uses (positive = expense)
};

/**
 * "Edit transactions" affordance for a Recent-transactions list.
 * Clicking Edit pops a modal showing the same transactions with
 * checkboxes + Select all, a "Type 'delete' to confirm" textbox, and
 * a destructive button that's disabled until both (a) at least one
 * row is selected AND (b) the user types `delete` verbatim. The
 * server action re-checks both rules.
 *
 * The actual delete is performed by the `action` server function
 * passed in by the parent, that way the consumer page authenticates
 * via company_members (manager/owner role) and the firm-side page
 * authenticates via firm_engagements access, each enforcing its own
 * scope server-side.
 *
 * Form payload posted to `action`:
 *   confirm   - the typed string (server requires exactly "delete")
 *   tx_ids[]  - selected ids
 *   + whatever scoping fields the parent provided via `hiddenFields`
 *     (e.g. company_id on the consumer page, engagement_id on firm)
 *
 * Defense-in-depth: the UI's `disabled` is the friendly guard; the
 * server action does the real validation (role, ownership, literal
 * "delete" string) so curl bypasses can't slip through.
 */
export function TransactionsBulkDeleter({
  action,
  hiddenFields,
  transactions,
}: {
  action: (formData: FormData) => Promise<unknown>;
  /** Scoping ids (company_id / engagement_id / etc.) sent on every submit. */
  hiddenFields: Record<string, string>;
  transactions: DeletableTx[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const allSelected = useMemo(
    () =>
      transactions.length > 0 && selected.size === transactions.length,
    [transactions, selected],
  );
  const confirmReady =
    selected.size > 0 && typed.trim().toLowerCase() === "delete";

  function close() {
    setOpen(false);
    setSelected(new Set());
    setTyped("");
    setError(null);
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(
      allSelected ? new Set() : new Set(transactions.map((t) => t.id)),
    );
  }
  function doDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        for (const [k, v] of Object.entries(hiddenFields)) fd.set(k, v);
        fd.set("confirm", typed.trim().toLowerCase());
        for (const id of selected) fd.append("tx_ids", id);
        await action(fd);
        close();
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Delete failed.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-forest-700 hover:text-forest-900 underline underline-offset-2"
      >
        ✎ Edit
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Delete transactions"
          className="fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: "rgba(18, 26, 42, 0.7)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) close();
          }}
        >
          <div
            className="card card-opaque w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
            style={{ borderColor: "#b91c1c33" }}
          >
            <header className="px-5 py-4 border-b border-forest-100 flex items-center justify-between gap-3">
              <div>
                <h2
                  className="display text-xl"
                  style={{ color: "#b91c1c" }}
                >
                  Delete transactions
                </h2>
                <p className="text-xs text-ink-muted mt-0.5">
                  Permanently removes the selected rows from this
                  company. No Undo.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="text-sm text-ink-muted hover:text-forest-900 disabled:opacity-50"
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            <div className="px-5 py-3 border-b border-forest-100 flex items-center justify-between gap-3 text-xs">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="size-4"
                />
                <span className="text-forest-800">
                  {allSelected ? "Deselect all" : "Select all"}
                </span>
              </label>
              <span className="text-ink-muted">
                {selected.size} of {transactions.length} selected
              </span>
            </div>

            <ul className="overflow-y-auto flex-1 divide-y divide-forest-100">
              {transactions.map((t) => {
                const checked = selected.has(t.id);
                const usd = new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                }).format(Math.abs(t.amountCents) / 100);
                const isExpense = t.amountCents > 0;
                return (
                  <li key={t.id}>
                    <label className="flex items-center gap-3 px-5 py-2.5 cursor-pointer hover:bg-forest-50/50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(t.id)}
                        className="size-4 shrink-0"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="text-sm text-forest-900 truncate block">
                          {t.merchant}
                        </span>
                        <span className="text-[11px] text-ink-muted">
                          {new Date(t.date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </span>
                      <span
                        className={
                          "text-sm tabular-nums " +
                          (isExpense
                            ? "text-forest-900"
                            : "text-green-700")
                        }
                      >
                        {isExpense ? "" : "+"}
                        {usd}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <footer className="px-5 py-4 border-t border-forest-100 grid gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-forest-800">
                  Type <code className="font-mono px-1 bg-cream rounded">delete</code>{" "}
                  to confirm:
                </span>
                <input
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="delete"
                  autoComplete="off"
                  className="input"
                />
              </label>
              {error ? (
                <p className="text-sm" style={{ color: "#e6b8a8" }}>
                  {error}
                </p>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={pending}
                  className="text-sm text-ink-muted hover:text-forest-900 px-3 py-2"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={!confirmReady || pending}
                  className="rounded-xl px-4 py-2 font-semibold text-cream disabled:opacity-50"
                  style={{
                    background:
                      confirmReady && !pending ? "#b91c1c" : "#7f1d1d",
                  }}
                >
                  {pending
                    ? "Deleting…"
                    : `Delete ${selected.size || ""}`.trim()}
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
