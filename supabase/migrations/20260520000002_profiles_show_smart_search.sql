-- Per-user opt-in for the Bella smart-search bar in the header.
--
-- PR #160 shipped the Bella-powered search input as a default-on
-- feature in the consumer header. Some users find the search visually
-- noisy and want a quieter header by default. Switching the
-- default to OFF and surfacing a Settings toggle gives them the
-- header they want without removing the feature for users who do
-- use it.
--
-- Default false everywhere — existing users see the header without
-- the search bar after this lands. Flipping the toggle in
-- /settings turns it back on for that user, cross-device.
alter table public.profiles
  add column if not exists show_smart_search boolean not null default false;
