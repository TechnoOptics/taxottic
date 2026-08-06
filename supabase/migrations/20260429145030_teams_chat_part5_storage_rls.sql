-- Recovered 20260429145030 (teams_chat_part5_storage_rls) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Storage RLS for chat-attachments bucket. Path convention:
--   <company_public_id>/<conversation_id>/<filename>
-- We use storage.foldername(name) to extract path segments. Note: the
-- storage.objects column is "name", and the function takes that text.

drop policy if exists "chat-attachments: read by conv member" on storage.objects;
create policy "chat-attachments: read by conv member"
  on storage.objects for select
  using (
    bucket_id = 'chat-attachments'
    and exists (
      select 1
      from public.companies c
      join public.chat_conversations cc on cc.company_id = c.id
      where c.public_id = (storage.foldername(storage.objects.name))[1]
        and cc.id::text = (storage.foldername(storage.objects.name))[2]
        and public.can_access_conversation(cc.id)
    )
  );

drop policy if exists "chat-attachments: insert by conv member" on storage.objects;
create policy "chat-attachments: insert by conv member"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-attachments'
    and exists (
      select 1
      from public.companies c
      join public.chat_conversations cc on cc.company_id = c.id
      where c.public_id = (storage.foldername(storage.objects.name))[1]
        and cc.id::text = (storage.foldername(storage.objects.name))[2]
        and public.can_access_conversation(cc.id)
    )
  );

drop policy if exists "chat-attachments: own delete" on storage.objects;
create policy "chat-attachments: own delete"
  on storage.objects for delete
  using (
    bucket_id = 'chat-attachments'
    and owner = auth.uid()
  );
