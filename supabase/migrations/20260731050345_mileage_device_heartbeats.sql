-- Recovered 20260731050345 (mileage_device_heartbeats) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.mileage_device_heartbeats (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  reported_at timestamptz not null default now(),
  platform text,
  app_version text,
  tracking_enabled boolean not null default false,
  buffer_size int not null default 0,
  last_cb_age_s int,
  fail_streak int not null default 0,
  location_authorization text,
  precise_location boolean,
  battery_optimized boolean,
  low_power_mode boolean,
  background_refresh boolean,
  last_exit_reason text,
  last_exit_at timestamptz,
  last_exit_detail jsonb,
  device_probe text,
  exit_probe text
);

create index if not exists mileage_device_heartbeats_driver_time_idx
  on public.mileage_device_heartbeats (driver_user_id, company_id, reported_at desc);
create index if not exists mileage_device_heartbeats_company_time_idx
  on public.mileage_device_heartbeats (company_id, reported_at desc);
create index if not exists mileage_device_heartbeats_reported_at_idx
  on public.mileage_device_heartbeats (reported_at);

alter table public.mileage_device_heartbeats enable row level security;

alter table public.mileage_device_status
  add column if not exists device_probe text;
alter table public.mileage_device_status
  add column if not exists exit_probe text;
