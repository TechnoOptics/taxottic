-- Per-document attribution for prior-year W-2s and 1099s. A married
-- couple uploads two W-2s during onboarding; the apply step needs to
-- know which one populates owner_w2_* vs spouse_w2_*. Default 'self'
-- so existing rows keep their previous behaviour.

alter table public.prior_year_documents
  add column if not exists for_person text not null default 'self'
  check (for_person in ('self', 'spouse'));

create index if not exists prior_year_docs_for_person_idx
  on public.prior_year_documents (user_id, tax_year, for_person)
  where applied_at is null;
