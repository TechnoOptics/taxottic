-- Recovered 20260429134817 (company_logos) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Allow each company to carry a logo. The image lives in Supabase Storage
-- under a public-read bucket; companies.logo_url stores the resolved
-- public URL so consumers (forecast hero, profile, year-end export,
-- dashboard cards) just slap it into an <img> with no auth dance.
alter table public.companies
  add column if not exists logo_url text;

-- Create the bucket if it doesn't exist. Public read so the URL works
-- in <img> tags from anywhere; uploads/updates/deletes are gated by
-- RLS on storage.objects below to managers of the owning company.
insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', true)
on conflict (id) do nothing;

-- Path convention: <company_public_id>/<filename>. The first path
-- segment is the company's public_id (co_*) so RLS can look up the
-- caller's manager status in one join.

drop policy if exists "company-logos: public read" on storage.objects;
create policy "company-logos: public read"
  on storage.objects for select
  using (bucket_id = 'company-logos');

drop policy if exists "company-logos: manager insert" on storage.objects;
create policy "company-logos: manager insert"
  on storage.objects for insert
  with check (
    bucket_id = 'company-logos'
    and exists (
      select 1
      from public.companies c
      join public.company_members cm on cm.company_id = c.id
      where c.public_id = (storage.foldername(name))[1]
        and cm.user_id = auth.uid()
        and cm.role = 'manager'
    )
  );

drop policy if exists "company-logos: manager update" on storage.objects;
create policy "company-logos: manager update"
  on storage.objects for update
  using (
    bucket_id = 'company-logos'
    and exists (
      select 1
      from public.companies c
      join public.company_members cm on cm.company_id = c.id
      where c.public_id = (storage.foldername(name))[1]
        and cm.user_id = auth.uid()
        and cm.role = 'manager'
    )
  );

drop policy if exists "company-logos: manager delete" on storage.objects;
create policy "company-logos: manager delete"
  on storage.objects for delete
  using (
    bucket_id = 'company-logos'
    and exists (
      select 1
      from public.companies c
      join public.company_members cm on cm.company_id = c.id
      where c.public_id = (storage.foldername(name))[1]
        and cm.user_id = auth.uid()
        and cm.role = 'manager'
    )
  );
