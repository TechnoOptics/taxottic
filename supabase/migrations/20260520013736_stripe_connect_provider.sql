-- Recovered 20260520013736 (stripe_connect_provider) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.bank_connections
  drop constraint if exists bank_connections_provider_check;

alter table public.bank_connections
  add constraint bank_connections_provider_check
    check (provider in ('plaid', 'teller', 'mx', 'manual', 'stripe'));

comment on column public.bank_connections.provider is
  'Aggregator backing this connection. plaid = traditional bank/card via Plaid; teller/mx reserved for future swaps; manual = CSV import + manual entry; stripe = Stripe Connect (payment processor as an income source).';
