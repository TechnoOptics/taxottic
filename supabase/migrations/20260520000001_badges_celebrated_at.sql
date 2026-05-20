-- Track when a badge has been celebrated to the user, so the medal
-- overlay only fires ONCE per badge instead of every dashboard render.
--
-- Previous design relied on "evaluateBadges inserts new rows and
-- returns those codes; next render they already exist so the array
-- is empty." Brittle: any race / silent insert failure pops the
-- celebration again. The explicit celebrated_at flag is atomic and
-- survives reload mid-celebration.
--
-- After this migration evaluateBadges does:
--   1. Insert any newly-earned badges (idempotent on unique).
--   2. UPDATE ... SET celebrated_at = now() WHERE celebrated_at IS
--      NULL RETURNING badge_code — that's the one-shot pop list.
--
-- The pre-existing rows get celebrated_at = now() up front so users
-- who already saw their medals on the old code path don't see a wall
-- of pops the next time they load the dashboard.
alter table public.badges
  add column if not exists celebrated_at timestamptz;

-- Backfill: anything earned before this column existed has, by
-- assumption, already been seen at some point. Pre-mark celebrated so
-- it doesn't pop again. New badges land with celebrated_at = NULL
-- and pop exactly once.
update public.badges
  set celebrated_at = coalesce(awarded_at, now())
  where celebrated_at is null;

create index if not exists badges_uncelebrated_idx
  on public.badges (user_id)
  where celebrated_at is null;
