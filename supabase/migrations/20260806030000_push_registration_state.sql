-- Why a device never registers for push.
--
-- iOS has produced ZERO rows in device_tokens since the feature shipped,
-- while Android registered fine. Until now the only report was an
-- (added 2026-08-06) console.log of registrationError, which has two
-- problems: it fires only when register() was actually reached, and it
-- lands in Vercel runtime logs, which were unreadable for an entire
-- debugging session while PostgREST stayed available throughout. A
-- diagnostic you cannot query is not a diagnostic.
--
-- Latest-state, not a timeline: one row per (user, platform). The
-- question being answered is "why does this device not register", which
-- is a present-tense question, and a bounded table cannot become the
-- next thing that needs a retention cron.
create table if not exists public.push_registration_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null,
  -- The outcome ladder, in the order the client evaluates it:
  --   plugin_unavailable | flag_disabled | permission_denied
  --   | register_called | registered | registration_error | init_threw
  -- "register_called" persisting with no later "registered" or
  -- "registration_error" is itself the finding: APNs was asked and never
  -- answered, which no error handler would ever surface.
  status text not null,
  detail text,
  app_version text,
  attempts integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, platform)
);

alter table public.push_registration_state enable row level security;

-- Readable by the person it describes; written service-role only, the
-- same shape as mileage_device_status.
drop policy if exists push_registration_state_select_own
  on public.push_registration_state;
create policy push_registration_state_select_own
  on public.push_registration_state for select
  using (user_id = auth.uid());

comment on table public.push_registration_state is
  'Latest push-registration outcome per user per platform. Exists because iOS silently never registered and the failure was unobservable: no token row, no error, nothing to query.';
comment on column public.push_registration_state.status is
  'plugin_unavailable | flag_disabled | permission_denied | register_called | registered | registration_error | init_threw. A stuck "register_called" means APNs was asked and never replied.';
