-- Recovered 20260503180949 (create_taxottic_enterprise_inquiries) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.


-- Lead capture for Taxottic Enterprise prospects.
-- Submissions land here from the Techno Optics marketing site.
-- An admin reviews each inquiry, fills billing + subscription, then promotes
-- it to a firm via onboarded_firm_id (set when the firm row is created).

create extension if not exists "pgcrypto";

create table if not exists public.taxottic_enterprise_inquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  status text not null default 'new'
    check (status in ('new','reviewed','invoiced','onboarded','declined')),

  -- Prospect-supplied
  firm_name text not null,
  contact_name text not null,
  contact_role text,
  contact_email text not null,
  contact_phone text,
  firm_size text,
  current_software text,
  desired_tier text check (desired_tier in ('starter','pro','custom')),
  prospect_notes text,

  -- Admin-supplied
  admin_notes text,
  billing jsonb not null default '{}'::jsonb,
  subscription jsonb not null default '{}'::jsonb,

  onboarded_firm_id uuid references public.firms(id) on delete set null,
  onboarded_at timestamptz
);

create index if not exists tei_status_created_idx
  on public.taxottic_enterprise_inquiries (status, created_at desc);

-- RLS: enable but write no policies. Only service_role bypasses RLS, which is
-- exactly what we want — the public form route and the admin dashboard both
-- run server-side with the service_role key.
alter table public.taxottic_enterprise_inquiries enable row level security;

-- Auto-update updated_at on every UPDATE.
create or replace function public._tei_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tei_touch_updated_at on public.taxottic_enterprise_inquiries;
create trigger tei_touch_updated_at
  before update on public.taxottic_enterprise_inquiries
  for each row execute function public._tei_touch_updated_at();
