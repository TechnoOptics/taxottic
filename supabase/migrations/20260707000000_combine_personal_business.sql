-- Personal/Business separation, Phase 1.
--
-- Adds a per-user preference for whether the business (pass-through) net
-- rolls into the personal 1040 forecast. NULL = "not explicitly chosen",
-- which the app resolves to an entity-type-aware default (pass-through ->
-- combined, C-corp -> separate). See docs/PERSONAL_BUSINESS_SEPARATION_PLAN.md.
--
-- Additive + nullable, so existing users are unchanged: the resolver keeps
-- today's math for pass-through owners (combined) and only c_corp owners get
-- the separated behavior. The Settings toggle (Phase 3) writes true/false.
alter table public.profiles
  add column if not exists combine_personal_business boolean;

comment on column public.profiles.combine_personal_business is
  'User preference: fold business (pass-through) net into the personal tax '
  'forecast. NULL = use the entity-type-aware default (pass-through combined, '
  'C-corp separate). Set explicitly by the Settings toggle.';
