-- Allow filer types to combine W-2 + business owner.
--
-- People who run a side hustle on top of a day job have BOTH situations:
-- W-2 withholding (employer handles it) AND Schedule C / SE-tax exposure
-- (they handle it). Forcing them to pick one mode at signup hides the
-- forecast they actually need - the combined view that nets W-2
-- withholding against SE tax to show a single refund-or-owe number.
--
-- 'both' makes that explicit. Routing in app/dashboard/page.tsx treats
-- 'both' the same as 'business' (lands on the company dashboard, has
-- access to the personal forecast tile too) since the combined filer
-- needs the company creation flow anyway.

alter table public.profiles
  drop constraint if exists profiles_tax_filer_type_check;

alter table public.profiles
  add constraint profiles_tax_filer_type_check
    check (tax_filer_type in ('w2', 'business', 'both'));

comment on column public.profiles.tax_filer_type is
  'Filing mode: w2 = wage-earner only (no company); business = Schedule C only; both = W-2 + business owner combined; NULL = pre-fork users (treated as business until they pick).';
