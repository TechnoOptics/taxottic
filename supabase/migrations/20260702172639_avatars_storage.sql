-- Self-service avatar upload. profiles.avatar_url already exists (populated
-- from OAuth provider metadata at signup) but had no user-facing upload —
-- this adds a public-read Storage bucket + RLS so any signed-in user can
-- upload/replace/remove their OWN avatar, mirroring the company-logos
-- bucket pattern (20260429000001_company_logos.sql) but scoped to the
-- caller's own user id instead of a manager's company.
--
-- Path convention: <user_id>/avatar-<timestamp>.<ext>. The first path
-- segment is the uploader's own auth.uid(), so RLS is a direct equality
-- check with no join needed.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars: owner insert" on storage.objects;
create policy "avatars: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner update" on storage.objects;
create policy "avatars: owner update"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
