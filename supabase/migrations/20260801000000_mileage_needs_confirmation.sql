-- Mileage: mark a drive the machine ASSUMED rather than decided.
--
-- Auto-apply (PR #463) made drives land classified instead of queueing
-- for review. When the place heuristic cannot decide it returns a
-- blanket "business" default, and both outcomes leave classified_by
-- NULL, so an evidence-backed call and a guess were indistinguishable.
-- Only one of the four production companies has saved any mileage_places
-- at all, so for the rest the heuristic can never fire and every drive
-- takes the guess. That guess was being stored with real cents on it and
-- flowing straight into the Schedule C mileage deduction.
--
-- needs_confirmation = true means "no evidence supports this call".
-- Those rows are written with deduction_cents = 0, so every deduction
-- rollup (all of which sum stored deduction_cents filtered to business)
-- naturally excludes them until a human confirms. reclassifyTripCore
-- clears the flag and writes the real deduction.
--
-- Purely additive: one new nullable column. Existing rows keep NULL,
-- which reads as "not flagged" everywhere and leaves their stored
-- deduction untouched. Backfilling historical tax numbers is the
-- owner's call, not this migration's.

alter table public.mileage_trips
  add column if not exists needs_confirmation boolean;

comment on column public.mileage_trips.needs_confirmation is
  'True when the drive was auto-classified by the blanket default (no place evidence). Such rows store deduction_cents = 0 and are excluded from deduction totals until a human confirms. NULL = pre-flag row or an evidence-backed / human call.';
