"use client";

import { useState, useTransition } from "react";
import {
  CategoryCombobox,
  type CategoryOption,
} from "@/components/CategoryCombobox";
import { formatCents } from "@/lib/tax/forecast";

/**
 * Transaction row on the import-review page.
 *
 * Lives as a Client Component so we can do an OPTIMISTIC LEAVE
 * animation when the user either categorizes or ignores the row.
 * Before the slide-off, every row was a server component and the
 * only "feedback" the user got on a categorize/ignore was the page
 * re-rendering with the row visually unchanged (the picker just
 * showed the new value). User feedback (May 23 2026): "Once an
 * item has been allocated or skipped/ignored, please slide it off
 * the list ... so that the user feels like they are making
 * progress going down the list."
 *
 * The flow:
 *   1. User picks a category from the combobox (auto-submits) OR
 *      clicks Ignore.
 *   2. Local `phase` flips to "leaving" → CSS transition starts.
 *      The row collapses its max-height + opacity + translates
 *      right over ~350ms.
 *   3. AFTER the animation, the server action fires (revalidatePath
 *      runs → page rerenders without this row → React unmounts the
 *      component naturally).
 *
 * The server action is wrapped in a client async function so we can
 * sequence: animate first, then RPC. Calling the server action from
 * a client async still hits the revalidatePath behavior — server
 * actions don't care if their caller is server or client.
 *
 * For "categorize", the row leaves the ACTIVE list and reappears
 * elsewhere on the page in a "tagged" rollup section (rendered by
 * the parent — this component just animates out).
 */

const LEAVE_MS = 350;

type Tx = {
  id: string;
  description: string;
  amount_cents: number;
  posted_at: string | null;
  raw_category: string | null;
  suggested_category_code: string | null;
  applied_category_code: string | null;
  applied_expense_id: string | null;
  ignored: boolean;
};

type CatInfo = {
  label: string;
  scope: string;
  schedule_c_line: string | null;
  irc_section: string | null;
  irs_pub: string | null;
  irs_url: string | null;
};

type Props = {
  tx: Tx;
  importId: string;
  companyId: string;
  cats: CategoryOption[];
  frequentCodes: string[];
  catById: Map<string, CatInfo>;
  isCredit?: boolean;
  setTxCategory: (formData: FormData) => Promise<void>;
  ignoreTx: (formData: FormData) => Promise<void>;
  teachBella: (formData: FormData) => Promise<void>;
};

export function TxRow({
  tx,
  importId,
  companyId,
  cats,
  frequentCodes,
  catById,
  isCredit,
  setTxCategory,
  ignoreTx,
  teachBella,
}: Props) {
  const [phase, setPhase] = useState<"idle" | "leaving">("idle");
  const [_pending, startTransition] = useTransition();

  const isApplied = !!tx.applied_expense_id;
  const selected =
    tx.applied_category_code ?? tx.suggested_category_code ?? "";
  const label = cats.find((c) => c.code === selected)?.label;
  const cat = selected ? catById.get(selected) ?? null : null;
  const isTransfer = cat?.scope === "transfer";
  // 'refunded' category = an auto-netted pair found by the
  // findRefundPairs pass. We render a different prominent badge for
  // these so the user can see "this isn't an expense — it pairs
  // with another row to net zero."
  const isRefundPair = tx.applied_category_code === "refunded";
  const citationParts: string[] = [];
  if (cat && !isTransfer) {
    if (cat.schedule_c_line)
      citationParts.push(`Sched C ${cat.schedule_c_line}`);
    if (cat.irc_section) citationParts.push(`IRC §${cat.irc_section}`);
    if (cat.irs_pub) citationParts.push(cat.irs_pub);
  }
  const wasBellaSuggested =
    !!tx.suggested_category_code &&
    !tx.applied_category_code &&
    !isApplied;
  const defaultPattern = (tx.description ?? "")
    .split(/\s+/)
    .slice(0, 3)
    .join(" ")
    .slice(0, 80);

  // Wrap a server action: animate first, then commit. The page
  // re-renders without this row on revalidate, unmounting the
  // component naturally — so we never need to "undo" the leaving
  // state.
  const leaveAndCommit =
    (action: (fd: FormData) => Promise<void>) => async (fd: FormData) => {
      setPhase("leaving");
      await new Promise<void>((r) => setTimeout(r, LEAVE_MS));
      startTransition(() => {
        void action(fd);
      });
    };

  return (
    <li
      data-leaving={phase === "leaving"}
      className={
        // Base shell + responsive grid.
        "relative rounded-lg border bg-white/70 px-4 py-3 text-sm " +
        "min-w-0 " + // critical: lets flex children truncate cleanly across browsers (Opera/Safari were overflowing)
        // Left accent bar — bumps Bella-suggested rows into the
        // user's attention. Implemented as a 3px-thick left border
        // that color-swaps based on row state. The user reported
        // "Ask Bella suggested looks on the items, it is not
        // visible" — making the entire LEFT edge gold pulls the
        // eye in a way a 11px chip never can.
        (wasBellaSuggested
          ? "border-l-[3px] border-l-gold-500 border-y-forest-100 border-r-forest-100 shadow-[0_0_0_1px_var(--color-gold-200)] "
          : isRefundPair
            ? "border-l-[3px] border-l-emerald-500 border-y-forest-100 border-r-forest-100 "
            : "border-forest-100 ") +
        // Slide-off transition (categorize/ignore animation).
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
          {/* break-words lets the description wrap on a hyphen / mid-
              token when the row is narrow (Opera in particular was
              clipping with no wrap on the truncate above). On wider
              viewports the row stays single-line because the parent
              is flex-nowrap. */}
          <div className="text-forest-900 break-words sm:truncate">
            {tx.description}
          </div>
          <div className="text-xs text-ink-muted mt-0.5">
            {tx.posted_at ?? "-"}
            {tx.raw_category ? ` - ${tx.raw_category}` : ""}
          </div>
        </div>
        {(() => {
          const isMoneyBack = !!isCredit && tx.amount_cents < 0;
          if (isMoneyBack) {
            return (
              <div className="text-emerald-700 tabular-nums font-medium shrink-0">
                +{formatCents(Math.abs(tx.amount_cents))}
              </div>
            );
          }
          return (
            <div className="text-rose-800 tabular-nums font-medium shrink-0">
              {formatCents(tx.amount_cents)}
            </div>
          );
        })()}
      </div>

      {selected && cat ? (
        <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
          {wasBellaSuggested ? (
            // Bigger, higher-contrast chip. Was 11px / gold-50 bg /
            // gold-200 border (essentially gold-on-cream, very low
            // contrast — user reported "not visible"). Now: white
            // text on saturated gold-600 background, with a small
            // ✦ icon + bold label, so the chip is visually the
            // loudest element in the row.
            <span className="inline-flex items-center gap-1.5 text-white bg-gold-600 rounded-full px-2.5 py-1 font-semibold shadow-sm">
              <span aria-hidden="true">✦</span>
              <span>Bella suggests: {label}</span>
            </span>
          ) : null}
          {isRefundPair ? (
            <span className="inline-flex items-center gap-1.5 text-white bg-emerald-600 rounded-full px-2.5 py-1 font-semibold shadow-sm">
              <span aria-hidden="true">↺</span>
              <span>Netted refund · paired with charge</span>
            </span>
          ) : isTransfer ? (
            <span className="uppercase tracking-[0.18em] text-ink-muted">
              transfer · not a deduction
            </span>
          ) : citationParts.length > 0 ? (
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
        {isApplied ? (
          <span className="text-[11px] uppercase tracking-[0.2em] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
            Applied as {label}
          </span>
        ) : (
          <>
            <form
              action={leaveAndCommit(setTxCategory)}
              className="flex-1 min-w-0"
            >
              <input type="hidden" name="id" value={tx.id} />
              <input type="hidden" name="import_id" value={importId} />
              <CategoryCombobox
                name="category_code"
                defaultValue={selected}
                options={cats}
                frequentCodes={frequentCodes}
                placeholder="Pick a category…"
              />
              <button className="hidden">Save</button>
            </form>
            <form action={leaveAndCommit(ignoreTx)}>
              <input type="hidden" name="id" value={tx.id} />
              <input type="hidden" name="import_id" value={importId} />
              <button className="text-xs text-ink-muted hover:text-red-700 px-2 py-2">
                Ignore
              </button>
            </form>
          </>
        )}
      </div>

      <details className="mt-2">
        <summary className="text-[11px] text-forest-700 hover:text-forest-900 cursor-pointer select-none inline-flex items-center gap-1">
          <span aria-hidden="true">✦</span> Teach Bella this vendor
        </summary>
        <form
          action={teachBella}
          className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs"
        >
          <input type="hidden" name="company_id" value={companyId} />
          <input type="hidden" name="import_id" value={importId} />
          <label className="grid gap-1">
            <span className="text-ink-muted">Match (case-insensitive)</span>
            <input
              name="pattern"
              type="text"
              defaultValue={defaultPattern}
              className="input"
              required
            />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-muted">Match type</span>
            <select
              name="pattern_type"
              defaultValue="contains"
              className="input"
            >
              <option value="contains">Contains</option>
              <option value="starts_with">Starts with</option>
              <option value="exact">Exact</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-muted">Treat as</span>
            <select name="kind" defaultValue="expense" className="input">
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="ignore">Ignore (not deductible)</option>
              <option value="transfer">Transfer (between accounts)</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-muted">Category</span>
            <CategoryCombobox
              name="category_code"
              defaultValue={selected}
              options={cats}
              frequentCodes={frequentCodes}
              placeholder="— pick one —"
              autoSubmit={false}
              emptyLabel="— pick one —"
            />
          </label>
          <div className="sm:col-span-2 flex items-center gap-3">
            <button className="btn-ghost text-xs">Save rule</button>
            <span className="text-[11px] text-ink-muted">
              Applies to future imports for this company. Re-teaching the
              same pattern updates the existing rule.
            </span>
          </div>
        </form>
      </details>
    </li>
  );
}
