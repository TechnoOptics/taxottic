-- RLS on every new banking + sales-tax table.
-- bank_connection_secrets is the locked-down access-token store:
-- RLS enabled with NO policies = service-role only.

alter table public.bank_connections enable row level security;
alter table public.bank_connection_secrets enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.account_transactions enable row level security;
alter table public.account_transaction_suggestions enable row level security;
alter table public.sales_tax_state_rates enable row level security;
alter table public.sales_tax_records enable row level security;

drop policy if exists "bank_conn: member read" on public.bank_connections;
create policy "bank_conn: member read"
  on public.bank_connections for select
  using (public.is_company_member(company_id));

drop policy if exists "bank_conn: manager insert" on public.bank_connections;
create policy "bank_conn: manager insert"
  on public.bank_connections for insert
  with check (public.is_company_manager(company_id));

drop policy if exists "bank_conn: manager update" on public.bank_connections;
create policy "bank_conn: manager update"
  on public.bank_connections for update
  using (public.is_company_manager(company_id));

drop policy if exists "bank_conn: manager delete" on public.bank_connections;
create policy "bank_conn: manager delete"
  on public.bank_connections for delete
  using (public.is_company_manager(company_id));

drop policy if exists "bank_acct: member read" on public.bank_accounts;
create policy "bank_acct: member read"
  on public.bank_accounts for select
  using (
    exists (
      select 1 from public.bank_connections c
      where c.id = bank_accounts.connection_id
        and public.is_company_member(c.company_id)
    )
  );

drop policy if exists "bank_acct: manager update" on public.bank_accounts;
create policy "bank_acct: manager update"
  on public.bank_accounts for update
  using (
    exists (
      select 1 from public.bank_connections c
      where c.id = bank_accounts.connection_id
        and public.is_company_manager(c.company_id)
    )
  );

drop policy if exists "acct_tx: member read" on public.account_transactions;
create policy "acct_tx: member read"
  on public.account_transactions for select
  using (
    exists (
      select 1
      from public.bank_accounts a
      join public.bank_connections c on c.id = a.connection_id
      where a.id = account_transactions.account_id
        and public.is_company_member(c.company_id)
    )
  );

drop policy if exists "acct_tx: manager update" on public.account_transactions;
create policy "acct_tx: manager update"
  on public.account_transactions for update
  using (
    exists (
      select 1
      from public.bank_accounts a
      join public.bank_connections c on c.id = a.connection_id
      where a.id = account_transactions.account_id
        and public.is_company_manager(c.company_id)
    )
  );

drop policy if exists "ats: member read" on public.account_transaction_suggestions;
create policy "ats: member read"
  on public.account_transaction_suggestions for select
  using (
    exists (
      select 1
      from public.account_transactions t
      join public.bank_accounts a on a.id = t.account_id
      join public.bank_connections c on c.id = a.connection_id
      where t.id = account_transaction_suggestions.transaction_id
        and public.is_company_member(c.company_id)
    )
  );

drop policy if exists "stsr: public read" on public.sales_tax_state_rates;
create policy "stsr: public read"
  on public.sales_tax_state_rates for select
  using (true);

drop policy if exists "str: member read" on public.sales_tax_records;
create policy "str: member read"
  on public.sales_tax_records for select
  using (public.is_company_member(company_id));

drop policy if exists "str: manager write" on public.sales_tax_records;
create policy "str: manager write"
  on public.sales_tax_records for insert
  with check (public.is_company_manager(company_id));

drop policy if exists "str: manager update" on public.sales_tax_records;
create policy "str: manager update"
  on public.sales_tax_records for update
  using (public.is_company_manager(company_id));

drop policy if exists "str: manager delete" on public.sales_tax_records;
create policy "str: manager delete"
  on public.sales_tax_records for delete
  using (public.is_company_manager(company_id));
