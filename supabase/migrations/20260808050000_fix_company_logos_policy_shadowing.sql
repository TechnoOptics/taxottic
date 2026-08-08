-- company-logos write policies compared the wrong `name` column.
--
-- All three write policies (insert, update, delete) contained:
--
--   EXISTS (SELECT 1 FROM companies c JOIN company_members cm ...
--           WHERE c.public_id = (storage.foldername(c.name))[1] ...)
--
-- Inside that subquery `c` is the COMPANIES alias, so `c.name` is the
-- company's display name, not `storage.objects.name`. The unqualified
-- reference silently resolved to the inner relation and the policy stopped
-- constraining the object path at all.
--
-- Two consequences, one visible and one not:
--
--  1. Upload is broken shut. The predicate reduces to "this company's NAME
--     equals its own public_id", which is essentially never true, so every
--     insert is denied. The bucket holds 0 objects.
--
--  2. Cross-tenant write escalation. A manager who renames their company to
--     its own public_id makes that predicate TRUE, and because it no longer
--     references the object path, it is then true for EVERY object in the
--     bucket. That manager can overwrite or delete any other company's logo.
--     Renaming a company is ordinary self-service, so this needs no special
--     access to reach.
--
-- The sibling firm-logos policies get this right with
-- `storage.foldername(objects.name)`, which is the shape copied below. The
-- table is explicitly qualified so the same shadowing cannot recur.
--
-- Found by an audit dated 2026-08-01 and still live on 2026-08-08. Fixing
-- it now is cheap precisely because the bucket is empty; after the first
-- real upload this becomes a data-migration problem as well.

drop policy if exists "company-logos: manager insert" on storage.objects;
drop policy if exists "company-logos: manager update" on storage.objects;
drop policy if exists "company-logos: manager delete" on storage.objects;

create policy "company-logos: manager insert"
  on storage.objects for insert
  with check (
    bucket_id = 'company-logos'
    and exists (
      select 1
      from public.companies c
      join public.company_members cm on cm.company_id = c.id
      where c.public_id = (storage.foldername(storage.objects.name))[1]
        and cm.user_id = auth.uid()
        and cm.role = 'manager'::public.company_role
    )
  );

create policy "company-logos: manager update"
  on storage.objects for update
  using (
    bucket_id = 'company-logos'
    and exists (
      select 1
      from public.companies c
      join public.company_members cm on cm.company_id = c.id
      where c.public_id = (storage.foldername(storage.objects.name))[1]
        and cm.user_id = auth.uid()
        and cm.role = 'manager'::public.company_role
    )
  );

create policy "company-logos: manager delete"
  on storage.objects for delete
  using (
    bucket_id = 'company-logos'
    and exists (
      select 1
      from public.companies c
      join public.company_members cm on cm.company_id = c.id
      where c.public_id = (storage.foldername(storage.objects.name))[1]
        and cm.user_id = auth.uid()
        and cm.role = 'manager'::public.company_role
    )
  );
