-- Recovered 20260712042645 (mileage_device_status) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Latest known tracker state per (driver, company) device, reported by
-- the app (open/resume/toggle + periodically while tracking). This is
-- the DEVICE-TRUTH layer of the reliability plan: the server no longer
-- infers "tracker dead" purely from GPS silence — the app tells it
-- "toggle is ON but no plugin callback for 40 minutes" or (once the
-- native plugin ships) "authorization degraded to whileInUse".
-- Service-role writes via the API route; managers read via their own
-- surface (route-guarded, no direct client reads).
create table if not exists public.mileage_device_status (
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  platform text,
  app_version text,
  tracking_enabled boolean not null default false,
  buffer_size int not null default 0,
  last_cb_age_s int,
  fail_streak int not null default 0,
  -- Native-plugin fields (null until the DeviceStatus plugin ships):
  location_authorization text, -- always | whenInUse | denied | notDetermined
  precise_location boolean,
  battery_optimized boolean,
  low_power_mode boolean,
  reported_at timestamptz not null default now(),
  primary key (driver_user_id, company_id)
);
alter table public.mileage_device_status enable row level security;
