-- Recovered 20260524024643 (add_sponsorship_volunteer_mileage_categories) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Donation / charity categories. The existing `charity` row is
-- scope='personal' (IRC §170 → Schedule A itemized), which keeps it
-- out of the Schedule C import picker. Two additions cover the gap:
--
-- 1. `sponsorship` — when a sole prop sponsors a community event
--    with their business name on the banner, that's advertising
--    (IRC §162) and IS deductible on Schedule C. Distinct from the
--    generic `advertising` so users can track sponsorship spend
--    separately.
--
-- 2. `volunteer_mileage` — drives for charitable purposes get a
--    14¢/mile rate under IRC §170(j). Personal scope; not on
--    Schedule C. Tracked here so charity rows can be tagged
--    consistently with the IRC citation.

insert into public.deduction_categories
  (code, label, description, scope, schedule_c_line, irc_section,
   irs_pub, irs_url, is_meal, is_vehicle, display_order,
   is_typically_recurring)
values
  (
    'sponsorship',
    'Sponsorship & community donations (business)',
    'Donations or sponsorships where your business name appears on the event/material — deductible as advertising on Schedule C Line 8 under IRC §162. NOT the same as personal charitable contributions (those go on Schedule A under IRC §170).',
    'business',
    'Line 8',
    '§162',
    'Pub 535',
    'https://www.irs.gov/forms-pubs/about-publication-535',
    false, false, 11, false
  ),
  (
    'volunteer_mileage',
    'Volunteer / charitable mileage',
    'Driving for a qualified charity. Deductible at $0.14/mile (Schedule A itemized, IRC §170(j)) — a much lower rate than business mileage. Tolls + parking related to the volunteer drive are also deductible.',
    'personal',
    null,
    '§170(j)',
    'Pub 526',
    'https://www.irs.gov/forms-pubs/about-publication-526',
    false, true, 1015, false
  )
on conflict (code) do nothing
returning code, label, scope;
