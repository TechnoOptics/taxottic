-- How to read the signs in one import's rows.
--
-- A 2026-08-01 import used charges-positive, refunds-negative. The review
-- page filtered candidates with amount_cents < 0, so it hid sixty real
-- expenses and offered two refunds. There was no way to correct it after
-- upload. See docs/superpowers/specs/2026-08-06-csv-sign-convention-design.md.
--
-- Additive and nullable-by-default in effect: the default reproduces
-- today's behaviour exactly, so no existing import changes meaning and no
-- stored amount is rewritten. Ever.
alter table public.bank_imports
  add column if not exists sign_convention text not null
    default 'charges_negative'
    check (sign_convention in ('charges_negative', 'charges_positive')),
  add column if not exists sign_convention_source text
    check (sign_convention_source is null
           or sign_convention_source in ('detected', 'user')),
  add column if not exists sign_convention_confidence numeric(3,2),
  add column if not exists sign_convention_set_at timestamptz;

comment on column public.bank_imports.sign_convention is
  'Which sign means money out. charges_negative reproduces the pre-2026-08 behaviour and is the default so no existing import changes meaning.';
comment on column public.bank_imports.sign_convention_source is
  'detected = the parser inferred it, user = a human set it. The first question asked of a wrong number months later is which of those happened.';
