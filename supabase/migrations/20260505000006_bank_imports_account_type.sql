-- Capture account type at CSV-import time so the apply step can route
-- transactions correctly. The big behavior change is for credit-card
-- imports: every charge becomes an expense regardless of sign,
-- because issuers report charges with inconsistent signs across CSV
-- formats and the user already knows it's a card.
--
-- Allowed values:
--   checking          personal or unspecified checking account
--   savings           personal savings
--   business_checking business checking (so the UI can label it that way)
--   business_savings  business savings
--   credit            credit-card account — every row treated as expense
--   other             escape hatch for cash, prepaid, brokerage, etc.
--
-- 'checking' is the default for backwards compat with existing imports
-- (which assumed a checking-style sign convention).

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
