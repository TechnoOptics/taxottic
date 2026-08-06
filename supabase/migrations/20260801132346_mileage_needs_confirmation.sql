-- Recovered 20260801132346 (mileage_needs_confirmation) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.mileage_trips
  add column if not exists needs_confirmation boolean;

comment on column public.mileage_trips.needs_confirmation is
  'True when the drive was auto-classified by the blanket default (no place evidence). Such rows store deduction_cents = 0 and are excluded from deduction totals until a human confirms. NULL = pre-flag row or an evidence-backed / human call.';
