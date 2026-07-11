-- Per-company display-name override, editable by the company manager.
-- Deliberately NOT profiles.full_name: that is the user's own global
-- identity (shared with their personal side); a manager may only shape
-- how the member appears inside THIS company (roster, attribution,
-- driver picker). NULL = fall back to profiles.full_name.
alter table public.company_members
  add column if not exists display_name text;
comment on column public.company_members.display_name is
  'Manager-editable name override for this membership only; null falls back to profiles.full_name.';
