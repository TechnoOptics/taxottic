-- Lets us show the welcome tour exactly once per profile.
-- Set when the user dismisses the tour or finishes the last step.
alter table public.profiles
  add column if not exists tour_completed_at timestamptz;
