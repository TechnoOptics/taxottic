-- Recovered 20260515004758 (firm_phase4_notifications) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.firm_activity_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  last_digest_sent_at timestamptz,
  primary key (user_id, firm_id)
);

alter table public.firm_activity_reads enable row level security;

drop policy if exists "user reads own activity-reads" on public.firm_activity_reads;
create policy "user reads own activity-reads" on public.firm_activity_reads for select
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "user upserts own activity-reads" on public.firm_activity_reads;
create policy "user upserts own activity-reads" on public.firm_activity_reads for insert
  with check (user_id = auth.uid());

drop policy if exists "user updates own activity-reads" on public.firm_activity_reads;
create policy "user updates own activity-reads" on public.firm_activity_reads for update
  using (user_id = auth.uid());

do $$ begin
  create type public.firm_digest_cadence as enum ('off','daily','weekly');
exception when duplicate_object then null; end $$;

create table if not exists public.firm_notification_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  digest_cadence public.firm_digest_cadence not null default 'daily',
  digest_hour_utc int not null default 13 check (digest_hour_utc between 0 and 23),
  excluded_kinds text[] not null default '{}',
  primary key (user_id, firm_id)
);

alter table public.firm_notification_preferences enable row level security;

drop policy if exists "user reads own notif prefs" on public.firm_notification_preferences;
create policy "user reads own notif prefs" on public.firm_notification_preferences for select
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "user upserts own notif prefs" on public.firm_notification_preferences;
create policy "user upserts own notif prefs" on public.firm_notification_preferences for insert
  with check (user_id = auth.uid());

drop policy if exists "user updates own notif prefs" on public.firm_notification_preferences;
create policy "user updates own notif prefs" on public.firm_notification_preferences for update
  using (user_id = auth.uid());

create or replace function public.unread_firm_activity_count(p_firm_id uuid)
returns int language sql stable security definer set search_path = public as $fn$
  with read_cursor as (
    select coalesce(last_read_at, '1970-01-01'::timestamptz) as cursor
    from public.firm_activity_reads
    where user_id = auth.uid() and firm_id = p_firm_id
  )
  select least(50, (
    select count(*)::int from public.firm_activity_log
    where firm_id = p_firm_id
      and created_at > coalesce((select cursor from read_cursor), '1970-01-01'::timestamptz)
  ));
$fn$;

grant execute on function public.unread_firm_activity_count(uuid) to authenticated;

create or replace function public.mark_firm_activity_read(p_firm_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then return; end if;
  insert into public.firm_activity_reads(user_id, firm_id, last_read_at)
  values (auth.uid(), p_firm_id, now())
  on conflict (user_id, firm_id) do update set last_read_at = now();
end;
$fn$;

grant execute on function public.mark_firm_activity_read(uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.firm_activity_log;
exception when others then null; end $$;
