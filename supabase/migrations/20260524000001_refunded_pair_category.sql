-- `refunded` category for the auto-net flow. When Bella detects a
-- refund-charge pair from the same merchant for the same amount
-- within a reasonable time window, both rows are marked ignored=true
-- + applied_category_code='refunded' so:
--   - the rows stay attached to the import (audit trail)
--   - they don't appear in the active expense candidates list
--   - they don't book to monthly_expenses (transfer scope)
--   - the UI can render a distinct "✓ Netted refund" badge keyed
--     on this category code

insert into public.deduction_categories
  (code, label, description, scope, schedule_c_line, irc_section,
   irs_pub, irs_url, is_meal, is_vehicle, display_order,
   is_typically_recurring)
values
  (
    'refunded',
    'Refunded — netted with paired charge',
    'Refund/charge pair from the same merchant for the same amount within a reasonable window. Bella nets both sides so the import does not double-count an expense that was given back. Either side: tag manually with this if you spot a pair Bella missed.',
    'transfer',
    null,
    null,
    null,
    null,
    false, false, 2010, false
  )
on conflict (code) do nothing;
