-- monthly_income.recurring_key — a stable identity for a recurring revenue
-- stream (the Stripe subscription id), so the forecast projects each
-- customer subscription forward EXACTLY ONCE instead of once per charge.
--
-- The bug this closes: Stripe subscription revenue syncs as one
-- monthly_income row per charge, each tagged recurrence='monthly' from the
-- invoice's billing interval. The forecast (lib/tax/recurrence) expands
-- every recurring row from its month through December, so a customer paying
-- $100/mo with charges in Jan + Feb + Mar was projected as 12 + 11 + 10 =
-- 33 months of $100 — the same subscription counted as three different ones.
--
-- Grouping by amount alone is unsafe for income (many customers share one
-- plan price, so collapsing by amount would UNDER-count), so we need the
-- subscription id as the stream's identity. The recurrence anchor pass
-- (lib/banking/recurring.applyRecurringIncomeDetection) then keeps the
-- cadence on only the latest charge per recurring_key and demotes the
-- earlier charges to one_off (real past revenue, not re-projected).
--
-- Nullable: one-off sales, manual entries, and non-subscription deposits
-- carry no key and are completely unaffected.

alter table public.monthly_income
  add column if not exists recurring_key text;

create index if not exists monthly_income_recurring_key_idx
  on public.monthly_income (company_id, tax_year, recurring_key)
  where recurring_key is not null;
