-- Recovered 20260704173736 (receipt_policy) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.companies
  add column if not exists receipt_required_above_cents bigint;

comment on column public.companies.receipt_required_above_cents is
  'Manager policy: expenses strictly above this many cents require a scanned receipt. NULL disables the requirement.';

alter table public.monthly_expenses
  add column if not exists receipt_captured boolean not null default false;

comment on column public.monthly_expenses.receipt_captured is
  'True when this expense was committed via the receipt-scan flow (camera/OCR). Used to enforce companies.receipt_required_above_cents.';
