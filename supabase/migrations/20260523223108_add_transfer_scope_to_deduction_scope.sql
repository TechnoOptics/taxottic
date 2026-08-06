-- Recovered 20260523223108 (add_transfer_scope_to_deduction_scope) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter type deduction_scope add value if not exists 'transfer';
