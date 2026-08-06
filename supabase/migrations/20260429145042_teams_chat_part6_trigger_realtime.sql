-- Recovered 20260429145042 (teams_chat_part6_trigger_realtime) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create or replace function public.handle_new_company_create_general_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.chat_conversations (company_id, kind, name, is_default, created_by)
  values (new.id, 'channel', 'General', true, new.created_by)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_company_created on public.companies;
create trigger on_company_created
  after insert on public.companies
  for each row execute function public.handle_new_company_create_general_channel();

do $$ begin
  alter publication supabase_realtime add table public.chat_conversations;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.chat_conversation_members;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.chat_attachments;
exception when others then null; end $$;
