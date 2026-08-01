"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  CategoryCombobox,
  type CategoryOption,
} from "@/components/CategoryCombobox";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { formatCents } from "@/lib/tax/forecast";
import type { Eligibility } from "@/lib/csv/selection";

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
 * a client async still hits the revalidatePath behavior, server
 * actions don't care if their caller is server or client.
 *
 * For "categorize", the row leaves the ACTIVE list and reappears
 * elsewhere on the page in a "tagged" rollup section (rendered by
 * the parent, this component just animates out).
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
  /** Deep-linked from the outstanding-items list (?highlight=<id>) -
   *  scrolls this row into view and rings it briefly on mount so the
   *  user doesn't have to hunt for it in a long import. */
  highlight?: boolean;
  /** Why this row can or cannot be saved as a business expense. Omitted
   *  when the row is rendered outside the selection flow. */
  eligibility?: Eligibility;
  /** Ticked state, owned by the parent list. */
  selected?: boolean;
  /** Undefined means "no checkbox on this row". */
  onToggleSelected?: (id: string, next: boolean) => void;
};

/**
 * Short, plain reason a row cannot be saved. Every one of these was a case
 * the old apply path skipped silently, which is how a row could vanish
 * between "uploaded" and "applied" with nothing to explain the gap.
 */
const INELIGIBLE_REASON: Record<Eligibility, string | null> = {
  eligible: null,
  booked: "Already saved",
  ignored: "Skipped",
  needs_category: "Needs a category first",
  needs_date: "No readable date",
  out_of_range: "Outside this tax year",
  not_an_expense: "Not an expense",
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
  highlight,
  eligibility,
  selected: isSelected,
  onToggleSelected,
}: Props) {
  const [phase, setPhase] = useState<"idle" | "leaving">("idle");
  const [_pending, startTransition] = useTransition();
  const [justArrived, setJustArrived] = useState(!!highlight);
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!highlight) return;
    rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setJustArrived(false), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount
  }, []);

  const isApplied = !!tx.applied_expense_id;
  const selected =
    tx.applied_category_code ?? tx.suggested_category_code ?? "";
  const label = cats.find((c) => c.code === selected)?.label;
  const cat = selected ? catById.get(selected) ?? null : null;
  const isTransfer = cat?.scope === "transfer";
  // 'refunded' category = an auto-netted pair found by the
  // findRefundPairs pass. We render a different prominent badge for
  // these so the user can see "this isn't an expense, it pairs
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
  // component naturally, so we never need to "undo" the leaving
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
      ref={rowRef}
      id={`txn-${tx.id}`}
      data-leaving={phase === "leaving"}
      className={
        // Base shell + responsive grid.
        "relative rounded-lg border bg-white/70 px-4 py-3 text-sm " +
        "min-w-0 " + // critical: lets flex children truncate cleanly across browsers (Opera/Safari were overflowing)
        // Left accent bar, bumps Bella-suggested rows into the
        // user's attention. Implemented as a 3px-thick left border
        // that color-swaps based on row state. The user reported
        // "Ask Bella suggested looks on the items, it is not
        // visible", making the entire LEFT edge gold pulls the
        // eye in a way a 11px chip never can.
        (justArrived
          ? "border-l-[3px] border-l-forest-800 ring-2 ring-forest-800/30 "
          : wasBellaSuggested
            ? "border-l-[3px] border-l-gold-500 border-y-forest-100 border-r-forest-100 shadow-[0_0_0_1px_var(--color-gold-200)] "
            : isRefundPair
              ? "border-l-[3px] border-l-emerald-500 border-y-forest-100 border-r-forest-100 "
              : "border-forest-100 ") +
        // Slide-off transition (categorize/ignore animation) + the
        // highlight ring fading back out after it's served its purpose.
        "transition-all duration-[350ms] ease-out " +
        "data-[leaving=true]:opacity-0 " +
        "data-[leaving=true]:translate-x-12 " +
        "data-[leaving=true]:max-h-0 " +
        "data-[leaving=true]:py-0 " +
        "data-[leaving=true]:border-transparent " +
        "data-[leaving=true]:overflow-hidden"
      }
    >
      {/* flex-wrap below sm is deliberate: at 344px the amount drops to its
          own line and the description keeps the full row width. Forcing
          nowrap here is what squeezes a long description into a one-character
          column. */}
      <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap min-w-0">
        {onToggleSelected ? (
          // 44px tap target around a 20px box, so the checkbox is reachable
          // with a thumb on a 344px cover screen. `shrink-0` keeps it from
          // being squeezed to nothing when the description is long.
          <span className="-my-2 -ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center">
            <input
              type="checkbox"
              checked={!!isSelected}
              disabled={eligibility !== "eligible"}
              onChange={(e) => onToggleSelected(tx.id, e.target.checked)}
              aria-label={`Save ${tx.description} as a business expense`}
              className="h-5 w-5 cursor-pointer accent-[var(--accent-2)] disabled:cursor-not-allowed disabled:opacity-40"
            />
          </span>
        ) : null}
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
            // contrast, user reported "not visible"). Now: white
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

      {/* Say why a row cannot be saved, rather than showing a dead checkbox
          and leaving the user to guess. */}
      {eligibility && eligibility !== "eligible" && eligibility !== "booked" ? (
        <div className="mt-2 text-[11px] text-ink-muted">
          {INELIGIBLE_REASON[eligibility]}
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
            <SelectMenu
              name="pattern_type"
              ariaLabel="Match type"
              defaultValue="contains"
              options={[
                { value: "contains", label: "Contains" },
                { value: "starts_with", label: "Starts with" },
                { value: "exact", label: "Exact" },
              ]}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-muted">Treat as</span>
            <SelectMenu
              name="kind"
              ariaLabel="Treat as"
              defaultValue="expense"
              options={[
                { value: "expense", label: "Expense" },
                { value: "income", label: "Income" },
                { value: "ignore", label: "Ignore (not deductible)" },
                { value: "transfer", label: "Transfer (between accounts)" },
              ]}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-muted">Category</span>
            <CategoryCombobox
              name="category_code"
              defaultValue={selected}
              options={cats}
              frequentCodes={frequentCodes}
              placeholder="- pick one -"
              autoSubmit={false}
              emptyLabel="- pick one -"
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
