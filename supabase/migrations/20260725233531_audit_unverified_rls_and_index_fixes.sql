-- Recovered 20260725233531 (audit_unverified_rls_and_index_fixes) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Audit 2026-07-25: findings the verification agents never reached
-- (they died on a spend limit). Each was re-verified by hand against
-- the live catalog before writing this migration.

-- ── U3 (major): mileage inserts never checked company membership ──
-- WITH CHECK only proved driver_user_id = auth.uid(), so any signed-in
-- user could insert trips/points into ANY company_id, with arbitrary
-- deduction_cents and tax_year. Every other financial table already
-- requires is_company_member (e.g. "monthly_income: member insert").
drop policy if exists "mileage_trips driver full access" on public.mileage_trips;
create policy "mileage_trips driver full access" on public.mileage_trips
  for all
  using (driver_user_id = auth.uid())
  with check (
    driver_user_id = auth.uid()
    and is_company_member(company_id)
  );

drop policy if exists "mileage_points_raw: own insert" on public.mileage_points_raw;
create policy "mileage_points_raw: own insert" on public.mileage_points_raw
  for insert
  with check (
    driver_user_id = auth.uid()
    and is_company_member(company_id)
  );

-- ── U6 (major): bank feeds missed the member-privacy scoping ──
-- 20260704120000 deliberately ended "team transparency" for
-- monthly_income/monthly_expenses, but the banking policies still let
-- ANY member read the company's entire transaction history and
-- balances - strictly more sensitive than the rows that were locked
-- down. Managers (and engaged firms, which already have read access
-- elsewhere) keep full visibility.
drop policy if exists "acct_tx: member read" on public.account_transactions;
create policy "acct_tx: manager read" on public.account_transactions
  for select
  using (
    exists (
      select 1
      from bank_accounts a
      join bank_connections c on c.id = a.connection_id
      where a.id = account_transactions.account_id
        and (is_company_manager(c.company_id) or is_super_admin())
    )
  );

drop policy if exists "bank_acct: member read" on public.bank_accounts;
create policy "bank_acct: manager read" on public.bank_accounts
  for select
  using (
    exists (
      select 1 from bank_connections c
      where c.id = bank_accounts.connection_id
        and (is_company_manager(c.company_id) or is_super_admin())
    )
  );

drop policy if exists "bank_conn: member read" on public.bank_connections;
create policy "bank_conn: manager read" on public.bank_connections
  for select
  using (is_company_manager(company_id) or is_super_admin());

-- ── U8 (minor): chat membership insert didn't constrain WHO is added ──
-- The check only proved the CALLER can reach the conversation; the
-- inserted user_id was unconstrained, so any participant could add a
-- user from another company into a private group or DM and thereby
-- grant them full message read/write.
drop policy if exists "conv-members: insert by member" on public.chat_conversation_members;
create policy "conv-members: insert by member" on public.chat_conversation_members
  for insert
  with check (
    (
      can_access_conversation(conversation_id)
      or exists (
        select 1 from chat_conversations c
        where c.id = chat_conversation_members.conversation_id
          and c.created_by = auth.uid()
      )
    )
    -- The person being added must belong to the conversation's company.
    and exists (
      select 1
      from chat_conversations c
      join company_members cm on cm.company_id = c.company_id
      where c.id = chat_conversation_members.conversation_id
        and cm.user_id = chat_conversation_members.user_id
    )
  );

-- ── U9 (minor): "read-only" firms could delete/rewrite client data ──
-- DELETE is governed by USING alone, and USING included
-- firm_has_active_engagement_with, so an engaged firm could delete a
-- client's mileage geofences. Firms keep SELECT (their actual grant).
drop policy if exists "mileage_places company members manage" on public.mileage_places;
create policy "mileage_places company members manage" on public.mileage_places
  for all
  using (is_company_member(company_id) or is_super_admin())
  with check (is_company_member(company_id) or is_super_admin());

create policy "mileage_places firm read" on public.mileage_places
  for select
  using (firm_has_active_engagement_with(company_id));

-- ── U7 (major, perf): no index served the render-from-raw window ──
-- The hot queries deliberately include CONSUMED rows (never-shrink
-- rendering + broken-trip detection), but both existing indexes are
-- partial on consumed_at, so those scans degraded to sequential.
create index if not exists mileage_points_raw_window_idx
  on public.mileage_points_raw (driver_user_id, company_id, captured_at);
