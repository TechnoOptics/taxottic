-- Recovered 20260515005140 (firm_w9_forms) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

do $$ begin
  create type public.firm_w9_status as enum ('requested','received','verified','expired','invalid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.firm_w9_tin_type as enum ('ssn','ein');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.firm_w9_entity_type as enum (
    'individual','sole_prop','c_corp','s_corp','partnership','trust_estate',
    'llc_c_corp','llc_s_corp','llc_partnership','llc_single_member','other'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.firm_w9_forms (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  engagement_id uuid references public.firm_engagements(id) on delete set null,
  recipient_email text not null,
  request_token text not null unique,
  legal_name text,
  business_name text,
  entity_type public.firm_w9_entity_type,
  llc_tax_classification char(1),
  other_classification text,
  exempt_payee_code text,
  exempt_fatca_code text,
  address_line_1 text,
  address_line_2 text,
  address_city text,
  address_region text,
  address_postal_code text,
  tin_type public.firm_w9_tin_type,
  tin_digits text,
  signed_at timestamptz,
  signed_ip text,
  signed_user_agent text,
  signature_full_name text,
  status public.firm_w9_status not null default 'requested',
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  notes text,
  document_id uuid references public.firm_documents(id) on delete set null,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists firm_w9_forms_firm_email_unique
  on public.firm_w9_forms (firm_id, lower(recipient_email));
create index if not exists firm_w9_forms_firm_idx on public.firm_w9_forms (firm_id, status, created_at desc);
create index if not exists firm_w9_forms_token_idx on public.firm_w9_forms (request_token);
create index if not exists firm_w9_forms_email_idx on public.firm_w9_forms (lower(recipient_email));

alter table public.firm_w9_forms enable row level security;

drop policy if exists "firm members read w9s" on public.firm_w9_forms;
create policy "firm members read w9s" on public.firm_w9_forms for select
  using (public.is_firm_member(firm_id) or public.is_super_admin());

drop policy if exists "firm admins write w9s" on public.firm_w9_forms;
create policy "firm admins write w9s" on public.firm_w9_forms for all
  using (public.is_firm_owner_or_manager(firm_id)) with check (public.is_firm_owner_or_manager(firm_id));

create or replace function public.lookup_w9_request(p_token text)
returns table (
  id uuid, firm_id uuid, firm_name text, firm_logo_url text, firm_accent_color text,
  recipient_email text, status public.firm_w9_status, expires_at timestamptz
)
language sql stable security definer set search_path = public as $fn$
  select w.id, w.firm_id, f.name, f.logo_url, f.accent_color,
    w.recipient_email, w.status, w.expires_at
  from public.firm_w9_forms w join public.firms f on f.id = w.firm_id
  where w.request_token = p_token
    and w.status in ('requested','received') and w.expires_at > now()
  limit 1;
$fn$;

grant execute on function public.lookup_w9_request(text) to anon, authenticated;

create or replace function public.submit_w9_form(
  p_token text, p_legal_name text, p_business_name text,
  p_entity_type public.firm_w9_entity_type, p_llc_tax_classification char,
  p_other_classification text, p_exempt_payee_code text, p_exempt_fatca_code text,
  p_address_line_1 text, p_address_line_2 text, p_address_city text,
  p_address_region text, p_address_postal_code text,
  p_tin_type public.firm_w9_tin_type, p_tin_digits text,
  p_signature_full_name text, p_signed_ip text, p_signed_ua text
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_w9_id uuid;
begin
  if length(coalesce(p_legal_name, '')) < 1 then raise exception 'legal_name required'; end if;
  if p_tin_type is null or length(coalesce(p_tin_digits, '')) < 9 then raise exception 'tin required'; end if;
  if length(coalesce(p_signature_full_name, '')) < 1 then raise exception 'signature required'; end if;
  update public.firm_w9_forms set
    legal_name = p_legal_name, business_name = p_business_name, entity_type = p_entity_type,
    llc_tax_classification = p_llc_tax_classification, other_classification = p_other_classification,
    exempt_payee_code = p_exempt_payee_code, exempt_fatca_code = p_exempt_fatca_code,
    address_line_1 = p_address_line_1, address_line_2 = p_address_line_2,
    address_city = p_address_city, address_region = p_address_region, address_postal_code = p_address_postal_code,
    tin_type = p_tin_type, tin_digits = regexp_replace(p_tin_digits, '\D', '', 'g'),
    signed_at = now(), signed_ip = p_signed_ip, signed_user_agent = p_signed_ua,
    signature_full_name = p_signature_full_name, status = 'received', updated_at = now()
  where request_token = p_token and status in ('requested','received') and expires_at > now()
  returning id into v_w9_id;
  if v_w9_id is null then raise exception 'invalid_or_expired_token'; end if;
  return v_w9_id;
end;
$fn$;

grant execute on function public.submit_w9_form(
  text, text, text, public.firm_w9_entity_type, char, text, text, text,
  text, text, text, text, text, public.firm_w9_tin_type, text, text, text, text
) to anon, authenticated;

create or replace function public.firm_w9_forms_touch_updated_at()
returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end;
$fn$;
drop trigger if exists firm_w9_forms_touch on public.firm_w9_forms;
create trigger firm_w9_forms_touch before update on public.firm_w9_forms
  for each row execute function public.firm_w9_forms_touch_updated_at();
