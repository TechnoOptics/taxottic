-- Recovered 20260523223118 (seed_credit_card_payment_category) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

insert into public.deduction_categories
  (code, label, description, scope, schedule_c_line, irs_pub,
   is_meal, is_vehicle, display_order, is_typically_recurring)
values
  (
    'credit_card_payment',
    'Credit card payment',
    'Paying down a credit card balance from another account. NOT a deduction — the underlying purchases were already expensed on the credit-card import. This category exists so the row can be labelled and removed from the review queue without inflating the deduction.',
    'transfer',
    null,
    null,
    false,
    false,
    2000,
    true
  )
on conflict (code) do nothing
returning code, label, scope, display_order;
