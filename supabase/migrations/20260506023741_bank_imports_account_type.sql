-- Recovered 20260506023741 (bank_imports_account_type) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.bank_imports
  add column if not exists account_type text not null default 'checking'
    check (account_type in (
      'checking',
      'savings',
      'business_checking',
      'business_savings',
      'credit',
      'other'
    ));

comment on column public.bank_imports.account_type is
  'How to interpret signs on imported rows. credit = always expense; others = sign-based (negative is expense).';
