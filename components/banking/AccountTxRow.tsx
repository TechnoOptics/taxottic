"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  CategoryCombobox,
  type CategoryOption,
} from "@/components/CategoryCombobox";
import { SelectMenu, type SelectOption } from "@/components/ui/SelectMenu";
import { formatCents } from "@/lib/tax/forecast";

/**
 * Pending-review row for a Plaid-synced account_transaction on the
 * banks page. Same optimistic slide-off pattern as
 * components/import/TxRow.tsx: pick a category (or Dismiss), the row
 * collapses over ~350ms, THEN the server action fires so revalidate
 * lands after the animation instead of racing it.
 *
 * Unlike CSV bank_transactions, account_transactions carries no
 * category_code column, resolving a row means booking straight into
 * monthly_expenses/monthly_income (server action) rather than
 * stamping a label on the row itself. So there's no "tagged but not
 * booked" intermediate state here; a pick either books it or (for a
 * non-bookable scope) dismisses it.
 */

const LEAVE_MS = 350;

const INCOME_SOURCES: SelectOption[] = [
  { value: "", label: "- dismiss / not income -" },
  { value: "sales", label: "Sales" },
  { value: "services", label: "Services" },
  { value: "wages_w2", label: "Wages (W-2)" },
  { value: "interest", label: "Interest" },
  { value: "dividends", label: "Dividends" },
  { value: "rental", label: "Rental" },
  { value: "royalty", label: "Royalty" },
  { value: "other", label: "Other" },
];

type CatInfo = {
  label: string;
  scope: string;
  schedule_c_line: string | null;
  irc_section: string | null;
  irs_pub: string | null;
  irs_url: string | null;
};

type Tx = {
  id: string;
  posted_date: string;
  amount_cents: number;
  merchant_name: string | null;
  description: string | null;
  personal_finance_category: string | null;
};

type Props = {
  tx: Tx;
  cats: CategoryOption[];
  frequentCodes: string[];
  catById: Map<string, CatInfo>;
  /** Plaid-category-derived suggestion, same code lib/plaid/sync.ts
   *  would auto-apply, pre-selected here so a confirm is one click. */
  suggestedCode: string | null;
  categorizeAccountTx: (formData: FormData) => Promise<void>;
  dismissAccountTx: (formData: FormData) => Promise<void>;
  /** Deep-linked from the outstanding-items list (?highlight=<id>) -
   *  scrolls this row into view and rings it briefly on mount. */
  highlight?: boolean;
};

export function AccountTxRow({
  tx,
  cats,
  frequentCodes,
  catById,
  suggestedCode,
  categorizeAccountTx,
  dismissAccountTx,
  highlight,
}: Props) {
  const [phase, setPhase] = useState<"idle" | "leaving">("idle");
  const [_pending, startTransition] = useTransition();
  const incomeFormRef = useRef<HTMLFormElement | null>(null);
  const [justArrived, setJustArrived] = useState(!!highlight);
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!highlight) return;
    rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setJustArrived(false), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount
  }, []);

  const isExpense = tx.amount_cents > 0;
  const merchant = tx.merchant_name ?? tx.description ?? "Transaction";
  const date = new Date(tx.posted_date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const amount = formatCents(Math.abs(tx.amount_cents));
  const cat =
    isExpense && suggestedCode ? (catById.get(suggestedCode) ?? null) : null;
  const citationParts: string[] = [];
  if (cat) {
    if (cat.schedule_c_line)
      citationParts.push(`Sched C ${cat.schedule_c_line}`);
    if (cat.irc_section) citationParts.push(`IRC §${cat.irc_section}`);
    if (cat.irs_pub) citationParts.push(cat.irs_pub);
  }

  const leaveAndCommit =
    (action: (fd: FormData) => Promise<void>) => async (fd: FormData) => {
      setPhase("leaving");
      await new Promise<void>((r) => setTimeout(r, LEAVE_MS));
      startTransition(() => {
        void action(fd);
      });
    };

  const commitCategorize = leaveAndCommit(categorizeAccountTx);
  const commitDismiss = leaveAndCommit(dismissAccountTx);

  return (
    <li
      ref={rowRef}
      id={`txn-${tx.id}`}
      data-leaving={phase === "leaving"}
      className={
        "relative rounded-lg border bg-white/70 px-4 py-3 text-sm min-w-0 " +
        (justArrived
          ? "border-l-[3px] border-l-forest-800 ring-2 ring-forest-800/30 "
          : isExpense && cat
            ? "border-l-[3px] border-l-gold-500 border-y-forest-100 border-r-forest-100 shadow-[0_0_0_1px_var(--color-gold-200)] "
            : "border-forest-100 ") +
        "transition-all duration-[350ms] ease-out " +
        "data-[leaving=true]:opacity-0 " +
        "data-[leaving=true]:translate-x-12 " +
        "data-[leaving=true]:max-h-0 " +
        "data-[leaving=true]:py-0 " +
        "data-[leaving=true]:border-transparent " +
        "data-[leaving=true]:overflow-hidden"
      }
    >
      <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap min-w-0">
        <div className="min-w-0 flex-1 max-w-full overflow-hidden">
          <div className="text-forest-900 font-medium break-words sm:truncate">
            {merchant}
          </div>
          <div className="text-xs text-ink-muted mt-0.5">
            {date}
            {tx.personal_finance_category
              ? ` · ${tx.personal_finance_category.replace(/_/g, " ").toLowerCase()}`
              : ""}
          </div>
        </div>
        <div
          className={
            "tabular-nums font-medium shrink-0 " +
            (isExpense ? "text-forest-900" : "text-emerald-700")
          }
        >
          {isExpense ? amount : `+${amount}`}
        </div>
      </div>

      {cat ? (
        <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
          <span className="inline-flex items-center gap-1.5 text-white bg-gold-600 rounded-full px-2.5 py-1 font-semibold shadow-sm">
            <span aria-hidden="true">✦</span>
            <span>Bella suggests: {cat.label}</span>
          </span>
          {citationParts.length > 0 ? (
            <span className="text-ink-soft">
              {citationParts.map((p, i) => (
                <span key={p}>
                  {i > 0 ? " · " : ""}
                  {p}
                </span>
              ))}
              {cat.irs_url ? (
                <>
                  {" · "}
                  <a
                    href={cat.irs_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
                  >
                    irs.gov ↗
                  </a>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isExpense ? (
          <form action={commitCategorize} className="flex-1 min-w-0">
            <input type="hidden" name="id" value={tx.id} />
            <CategoryCombobox
              name="category_code"
              defaultValue={suggestedCode ?? ""}
              options={cats}
              frequentCodes={frequentCodes}
              placeholder="Pick a category…"
            />
            <button className="hidden">Save</button>
          </form>
        ) : (
          <form
            ref={incomeFormRef}
            action={commitCategorize}
            className="flex-1 min-w-0"
          >
            <input type="hidden" name="id" value={tx.id} />
            <SelectMenu
              name="category_code"
              ariaLabel="Income source"
              defaultValue={suggestedCode ?? ""}
              options={INCOME_SOURCES}
              onValueChange={() => incomeFormRef.current?.requestSubmit()}
            />
          </form>
        )}
        <form action={commitDismiss}>
          <input type="hidden" name="id" value={tx.id} />
          <button className="text-xs text-ink-muted hover:text-red-700 px-2 py-2">
            Dismiss
          </button>
        </form>
      </div>
    </li>
  );
}
