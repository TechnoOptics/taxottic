-- Tier 4 #2: entity-return draft kinds.
--
-- The Phase 5 firm_document_kind enum (migration 20260514000005)
-- already covers 1040_draft, k1_draft, schedule_c_draft, etc.
-- This migration appends the three entity-level draft kinds the
-- new generators emit.

do $$ begin
  alter type public.firm_document_kind add value if not exists '1065_draft';
exception when others then null; end $$;

do $$ begin
  alter type public.firm_document_kind add value if not exists '1120_draft';
exception when others then null; end $$;

do $$ begin
  alter type public.firm_document_kind add value if not exists '1120_s_draft';
exception when others then null; end $$;
