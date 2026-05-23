-- Add a "transfer" scope + a `credit_card_payment` category so users
-- can tag inter-account transfers (paying down a credit card from a
-- checking account, the most common case) without those rows landing
-- in their Schedule C totals.
--
-- Why a new SCOPE instead of just a new category code:
--   - Scope is what `runBellaCategorize` and every aggregator
--     (forecast, my-deductions, schedule-C export) keys off when
--     deciding what's a deduction. business/both = counts; personal
--     = excluded from biz totals.
--   - "transfer" carries the semantics correctly: NEVER a deduction,
--     should not surface in business or personal aggregations, but
--     is a real, useful label so the user can categorize the row
--     instead of letting it sit Untagged in the review queue forever.
--   - Bella's allowed-codes filter already does `scope IN
--     ('business','both')`, so adding transfer is automatically
--     excluded from auto-categorize. Bella will never pick this.
--
-- The corresponding code-side change is in
-- app/c/[publicId]/import/actions.ts (applyTransactions) which
-- now checks the chosen category's scope and routes transfer-scoped
-- rows via `ignored=true` on bank_transactions instead of inserting
-- a phantom expense.

alter type deduction_scope add value if not exists 'transfer';

-- Commit the enum change before referencing the new value, otherwise
-- the seed insert below errors with "unsafe use of new value of
-- enum type" in the same transaction. Standard Postgres gotcha.
commit;

begin;

-- Seed the credit_card_payment category. display_order 2000 puts it
-- after all business + personal codes so the review-page dropdown
-- groups it at the bottom; the "Not a deduction" feel is what we
-- want for inter-account transfers.
insert into public.deduction_categories
  (code, label, description, scope, schedule_c_line, irs_pub,
   is_meal, is_vehicle, display_order, is_typically_recurring)
values
  (
    'credit_card_payment',
    'Credit card payment',
    'Paying down a credit card balance from another account. NOT a deduction — the underlying purchases were already expensed on the credit-card import. This category exists so the row can be labelled and removed from the review queue without inflating the deduction.',
    'transfer',
    null,        -- not a Schedule C line
    null,        -- not in any IRS Pub
    false,
    false,
    2000,        -- after business (10-999) + personal (1010-1080)
    true         -- recurring monthly typically
  )
on conflict (code) do nothing;

commit;
