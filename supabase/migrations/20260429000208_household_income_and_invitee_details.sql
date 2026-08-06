-- Recovered 20260429000208 (household_income_and_invitee_details) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.tax_profiles
  add column if not exists owner_w2_wages_cents bigint not null default 0,
  add column if not exists owner_w2_withheld_cents bigint not null default 0,
  add column if not exists owner_w2_ss_wages_cents bigint not null default 0,
  add column if not exists spouse_w2_wages_cents bigint not null default 0,
  add column if not exists spouse_w2_withheld_cents bigint not null default 0,
  add column if not exists spouse_w2_ss_wages_cents bigint not null default 0,
  add column if not exists dependents_under_17 int not null default 0,
  add column if not exists itemized_total_cents bigint not null default 0;

alter table public.tax_profiles
  drop constraint if exists tax_profiles_dependents_under_17_lte_total;
alter table public.tax_profiles
  add constraint tax_profiles_dependents_under_17_lte_total
  check (dependents_under_17 >= 0 and dependents_under_17 <= dependents);

alter table public.invitations
  add column if not exists full_name text,
  add column if not exists title text,
  add column if not exists personal_message text;
