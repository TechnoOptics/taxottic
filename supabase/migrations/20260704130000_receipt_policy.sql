-- Item 10: manager-mandated receipt requirement above a price point.
--
-- A manager sets one company-wide threshold; any expense entered above it
-- must come in through the receipt-scan flow (camera capture + Bella OCR),
-- which stamps `receipt_captured = true`. The manual "Add an expense" form
-- cannot attach a receipt, so over-threshold amounts are rejected there and
-- the user is routed to the scanner. Enforced server-side in addExpense so a
-- crafted POST can't skip it.

-- Company-wide policy. NULL = no receipt ever required (the default, so
-- existing companies are unaffected). Value is the dollar amount, in cents,
-- ABOVE which a receipt becomes mandatory.
alter table public.companies
  add column if not exists receipt_required_above_cents bigint;

comment on column public.companies.receipt_required_above_cents is
  'Manager policy: expenses strictly above this many cents require a scanned receipt. NULL disables the requirement.';

-- Proof that a given expense row was created through the receipt-scan flow.
-- Defaults false so every existing row and every manual entry is "no receipt";
-- the ReceiptUploader commit path sets it true.
alter table public.monthly_expenses
  add column if not exists receipt_captured boolean not null default false;

comment on column public.monthly_expenses.receipt_captured is
  'True when this expense was committed via the receipt-scan flow (camera/OCR). Used to enforce companies.receipt_required_above_cents.';
