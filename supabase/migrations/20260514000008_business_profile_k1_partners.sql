-- Phase 11.5: K-1 partners list per company.
--
-- Partnership and S-Corp companies have multiple partners /
-- shareholders. The K-1 generator (lib/firm/documents/generate-k1.ts)
-- produces one K-1 per partner; we need a place to maintain the
-- list of partners + their ownership %. JSONB on business_profiles
-- keeps the schema light and lets the preparer edit one row.
--
-- Shape (validated at the application layer):
--   [
--     { "name": "Riley Chen", "ownership_pct": 0.6,
--       "partner_type": "general", "tin_placeholder": "111-22-3333",
--       "address": "123 Main St" },
--     { "name": "Jordan Park", "ownership_pct": 0.4,
--       "partner_type": "general" }
--   ]
--
-- Until a preparer fills this in, the K-1 action falls back to a
-- single 100% K-1 for the company manager as a starting point.

alter table public.business_profiles
  add column if not exists k1_partners jsonb not null default '[]'::jsonb;
