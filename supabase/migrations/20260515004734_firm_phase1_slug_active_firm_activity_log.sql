-- Recovered 20260515004734 (firm_phase1_slug_active_firm_activity_log) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.firms add column if not exists slug text;

alter table public.firms drop constraint if exists firms_slug_format_check;
alter table public.firms add constraint firms_slug_format_check
  check (slug is null or (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' and char_length(slug) between 3 and 32));

create unique index if not exists firms_slug_unique on public.firms (slug) where slug is not null;

alter table public.profiles add column if not exists active_firm_id uuid references public.firms(id) on delete set null;
create index if not exists profiles_active_firm_idx on public.profiles (active_firm_id) where active_firm_id is not null;

do $$ begin
  create type public.firm_activity_kind as enum (
    'client.company_created','client.income_logged','client.expense_logged','client.bank_connected',
    'client.document_uploaded','client.engagement_requested','client.engagement_accepted','client.message_sent',
    'firm.engagement_created','firm.engagement_accepted','firm.engagement_completed','firm.preparer_assigned',
    'firm.document_uploaded','firm.document_signed','firm.signature_requested','firm.meeting_scheduled',
    'firm.invoice_sent','firm.payment_received','firm.tax_form_drafted','firm.tax_form_filed','firm.note_added',
    'firm.member_invited','firm.member_joined','firm.member_removed'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.firm_activity_log (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  engagement_id uuid references public.firm_engagements(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_side text not null check (actor_side in ('firm','client','system')),
  kind public.firm_activity_kind not null,
  payload jsonb not null default '{}'::jsonb,
  summary text,
  created_at timestamptz not null default now()
);

create index if not exists firm_activity_log_firm_idx on public.firm_activity_log (firm_id, created_at desc);
create index if not exists firm_activity_log_company_idx on public.firm_activity_log (company_id, created_at desc) where company_id is not null;
create index if not exists firm_activity_log_engagement_idx on public.firm_activity_log (engagement_id, created_at desc) where engagement_id is not null;
create index if not exists firm_activity_log_kind_idx on public.firm_activity_log (firm_id, kind, created_at desc);

alter table public.firm_activity_log enable row level security;

drop policy if exists "firm admins read all firm activity" on public.firm_activity_log;
create policy "firm admins read all firm activity" on public.firm_activity_log for select
  using (public.is_firm_owner_or_manager(firm_id) or public.is_super_admin());

drop policy if exists "firm preparers read assigned engagement activity" on public.firm_activity_log;
create policy "firm preparers read assigned engagement activity" on public.firm_activity_log for select
  using (
    public.is_firm_member(firm_id)
    and engagement_id is not null
    and exists (select 1 from public.firm_engagements where id = firm_activity_log.engagement_id and assigned_preparer_id = auth.uid())
  );

drop policy if exists "company manager reads activity on own company" on public.firm_activity_log;
create policy "company manager reads activity on own company" on public.firm_activity_log for select
  using (company_id is not null and public.is_company_manager(company_id));

create or replace function public.log_firm_activity(
  p_firm_id uuid, p_company_id uuid, p_engagement_id uuid,
  p_kind public.firm_activity_kind, p_payload jsonb, p_summary text,
  p_actor_side text default 'firm'
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_id uuid;
begin
  if p_firm_id is null then raise exception 'firm_id is required'; end if;
  if p_actor_side not in ('firm','client','system') then raise exception 'invalid actor_side: %', p_actor_side; end if;
  if v_actor is not null then
    if not (public.is_firm_member(p_firm_id) or (p_company_id is not null and public.is_company_manager(p_company_id)) or public.is_super_admin()) then
      raise exception 'not authorized to log activity for firm %', p_firm_id;
    end if;
  end if;
  insert into public.firm_activity_log(firm_id, company_id, engagement_id, actor_user_id, actor_side, kind, payload, summary)
  values (p_firm_id, p_company_id, p_engagement_id, v_actor, p_actor_side, p_kind, coalesce(p_payload, '{}'::jsonb), p_summary)
  returning id into v_id;
  return v_id;
end;
$fn$;

grant execute on function public.log_firm_activity(uuid, uuid, uuid, public.firm_activity_kind, jsonb, text, text) to authenticated;
