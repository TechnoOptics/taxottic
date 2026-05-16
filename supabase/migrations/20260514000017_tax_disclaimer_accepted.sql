-- New-account legal disclaimer acknowledgement.
--
-- Taxottic produces tax FORECASTS / estimates, not filed returns or
-- tax advice. Before a new user starts entering data we show a
-- one-time screen that (a) builds confidence — math is updated for
-- the 2026 OBBBA / IRS guidelines and built carefully — and (b)
-- protects us — the user affirmatively acknowledges these are
-- estimates that can differ from a final return and that they should
-- confirm with a tax professional.
--
-- profiles.tax_disclaimer_accepted_at = the timestamp the user
-- clicked "I understand". NULL = not yet acknowledged; the dashboard
-- onboarding gate routes those users to /onboarding/disclaimer before
-- anything else (mirrors the tax_filer_type fork pattern). Nullable +
-- additive, so it is safe to apply ahead of the code deploy and is
-- covered by the existing per-row RLS on profiles.

alter table public.profiles
  add column if not exists tax_disclaimer_accepted_at timestamptz;

comment on column public.profiles.tax_disclaimer_accepted_at is
  'When the user acknowledged the forecast/estimate legal disclaimer. NULL = show /onboarding/disclaimer before any other onboarding step.';
