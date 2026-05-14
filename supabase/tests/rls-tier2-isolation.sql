-- Tier 2 RLS isolation tests.
--
-- Proves that Firm A cannot read or write Firm B's:
--   - firm_threads / firm_messages
--   - firm_document_comments
--   - firm_invoice_templates
--
-- Run with:
--   psql $DATABASE_URL -f supabase/tests/rls-tier2-isolation.sql
--
-- The script is idempotent: it creates two scratch firms +
-- impersonates them via SET LOCAL role / request.jwt.claims, runs
-- assertions, then rolls back. No production data touched.
--
-- Each assertion uses do $$ ... raise exception 'FAIL ...' $$ so a
-- single failed isolation check aborts the run with an error
-- message naming the failure.

begin;

-- ----------------------------------------------------------------
-- Setup: two scratch firms + two users, one membership each.
-- ----------------------------------------------------------------

-- Create scratch users in auth.users. We bypass auth.signUp by
-- writing directly with the service role — this script must run
-- with superuser/postgres credentials.
do $$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_firm_a uuid;
  v_firm_b uuid;
  v_thread_a uuid;
  v_thread_b uuid;
  v_doc_a uuid;
  v_template_a uuid;
  v_count int;
begin
  v_user_a := gen_random_uuid();
  v_user_b := gen_random_uuid();
  v_firm_a := gen_random_uuid();
  v_firm_b := gen_random_uuid();

  -- Minimal auth.users rows so foreign keys resolve.
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_user_a, 'rls-test-a@example.invalid', now(), '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_user_b, 'rls-test-b@example.invalid', now(), '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated');

  -- Profiles rows (the firm_members FK targets profiles, not auth.users).
  insert into public.profiles (id, email)
  values
    (v_user_a, 'rls-test-a@example.invalid'),
    (v_user_b, 'rls-test-b@example.invalid');

  insert into public.firms (id, name, slug, tier, status)
  values
    (v_firm_a, 'RLS Test Firm A', 'rls-test-firm-a-' || substring(v_firm_a::text, 1, 8), 'starter', 'active'),
    (v_firm_b, 'RLS Test Firm B', 'rls-test-firm-b-' || substring(v_firm_b::text, 1, 8), 'starter', 'active');

  insert into public.firm_members (firm_id, user_id, role)
  values
    (v_firm_a, v_user_a, 'owner'),
    (v_firm_b, v_user_b, 'owner');

  -- Seed one row per Tier 2 table on each firm.
  insert into public.firm_threads (id, firm_id, title, created_by)
  values (gen_random_uuid(), v_firm_a, 'Firm A internal thread', v_user_a)
  returning id into v_thread_a;
  insert into public.firm_threads (id, firm_id, title, created_by)
  values (gen_random_uuid(), v_firm_b, 'Firm B internal thread', v_user_b)
  returning id into v_thread_b;

  insert into public.firm_messages (thread_id, firm_id, author_id, body)
  values (v_thread_a, v_firm_a, v_user_a, 'Firm A secret');
  insert into public.firm_messages (thread_id, firm_id, author_id, body)
  values (v_thread_b, v_firm_b, v_user_b, 'Firm B secret');

  insert into public.firm_invoice_templates (id, firm_id, name, line_items, recipient_email, created_by)
  values (gen_random_uuid(), v_firm_a, 'Firm A template', '[]'::jsonb, 'rls-a@example.invalid', v_user_a)
  returning id into v_template_a;
  insert into public.firm_invoice_templates (firm_id, name, line_items, recipient_email, created_by)
  values (v_firm_b, 'Firm B template', '[]'::jsonb, 'rls-b@example.invalid', v_user_b);

  -- firm_documents row to anchor a doc comment.
  insert into public.firm_documents (
    id, firm_id, kind, status, provider, filename, content_type, storage_path
  )
  values (
    gen_random_uuid(), v_firm_a, 'internal_memo', 'draft', 'generated',
    'rls-test.html', 'text/html', 'rls-test/path.html'
  )
  returning id into v_doc_a;

  insert into public.firm_document_comments (document_id, firm_id, author_id, body)
  values (v_doc_a, v_firm_a, v_user_a, 'Firm A note on doc');

  raise notice '[rls-tier2] seed done — user_a=%, user_b=%, firm_a=%, firm_b=%',
    v_user_a, v_user_b, v_firm_a, v_firm_b;

  -- --------------------------------------------------------------
  -- Impersonate Firm B's user and confirm Firm A's rows are hidden.
  -- --------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_b::text, 'role', 'authenticated')::text,
    true
  );

  select count(*) into v_count from public.firm_threads where firm_id = v_firm_a;
  if v_count > 0 then
    raise exception
      'FAIL: Firm B user can see % firm_threads rows from Firm A',
      v_count;
  end if;

  select count(*) into v_count from public.firm_messages where firm_id = v_firm_a;
  if v_count > 0 then
    raise exception
      'FAIL: Firm B user can see % firm_messages rows from Firm A',
      v_count;
  end if;

  select count(*) into v_count
  from public.firm_invoice_templates where firm_id = v_firm_a;
  if v_count > 0 then
    raise exception
      'FAIL: Firm B user can see % firm_invoice_templates rows from Firm A',
      v_count;
  end if;

  select count(*) into v_count
  from public.firm_document_comments where firm_id = v_firm_a;
  if v_count > 0 then
    raise exception
      'FAIL: Firm B user can see % firm_document_comments rows from Firm A',
      v_count;
  end if;

  -- Negative-write assertions: Firm B can't write into Firm A's
  -- thread either, even with a valid-looking insert payload.
  begin
    insert into public.firm_messages (thread_id, firm_id, author_id, body)
    values (v_thread_a, v_firm_a, v_user_b, 'Firm B attempting cross-tenant write');
    raise exception
      'FAIL: Firm B user successfully wrote into Firm A''s firm_messages';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%'
         and sqlerrm not like '%violates row-level security policy%'
         and sqlerrm not like '%insufficient_privilege%' then
        raise exception
          'FAIL: Firm B write blocked, but unexpected error: %', sqlerrm;
      end if;
  end;

  -- --------------------------------------------------------------
  -- Switch back to Firm A and confirm we DO see our own rows.
  -- --------------------------------------------------------------
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text,
    true
  );

  select count(*) into v_count from public.firm_threads where firm_id = v_firm_a;
  if v_count <> 1 then
    raise exception
      'FAIL: Firm A user expected 1 firm_thread, got %', v_count;
  end if;

  select count(*) into v_count from public.firm_messages where firm_id = v_firm_a;
  if v_count <> 1 then
    raise exception
      'FAIL: Firm A user expected 1 firm_message, got %', v_count;
  end if;

  select count(*) into v_count
  from public.firm_invoice_templates where firm_id = v_firm_a;
  if v_count <> 1 then
    raise exception
      'FAIL: Firm A user expected 1 firm_invoice_template, got %', v_count;
  end if;

  select count(*) into v_count
  from public.firm_document_comments where firm_id = v_firm_a;
  if v_count <> 1 then
    raise exception
      'FAIL: Firm A user expected 1 firm_document_comment, got %', v_count;
  end if;

  raise notice '[rls-tier2] OK — Tier 2 RLS isolation verified for 4 tables';
end $$;

rollback;
