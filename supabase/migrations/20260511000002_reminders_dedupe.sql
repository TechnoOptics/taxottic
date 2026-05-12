-- Reminders deduplication + unique constraint.
--
-- Demo testing surfaced each federal tax date 8x on /reminders. Root
-- cause: ensureQuarterlyReminders() runs on every dashboard load and
-- the dashboard page issues many concurrent Supabase calls under
-- Promise.all. With no DB-level uniqueness, two concurrent renders
-- both saw "nothing exists, insert the full set" and we got two
-- copies. Over time, repeated dashboard hits in parallel from
-- different tabs/devices stacked the duplicates.
--
-- Two-part fix:
--   1. Delete existing duplicates (keep the oldest row by id per
--      user_id + kind + due_at::date), so /reminders stops showing 8
--      of every date.
--   2. Add a unique index on (user_id, kind, due_at::date) so future
--      concurrent inserts collide cleanly and the second one no-ops.
--      The seed function will be updated to use UPSERT with
--      ON CONFLICT DO NOTHING.
--
-- due_at is timestamptz; casting to date in UTC keeps the unique
-- key stable regardless of session timezone.

-- 1. Dedupe existing rows. CTE finds duplicate groups and keeps the
-- minimum id (oldest insertion) per group; delete everything else.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, kind, (due_at at time zone 'UTC')::date
      order by id asc
    ) as rn
  from public.reminders
)
delete from public.reminders r
  using ranked
  where r.id = ranked.id
    and ranked.rn > 1;

-- 2. Prevent recurrence. Functional unique index on the (UTC) date
-- bucket of due_at, scoped per user + reminder kind.
create unique index if not exists reminders_user_kind_dueday_uq
  on public.reminders (
    user_id,
    kind,
    ((due_at at time zone 'UTC')::date)
  );

comment on index public.reminders_user_kind_dueday_uq is
  'Prevents duplicate quarterly/filing reminders for the same user+kind+date. Concurrent ensureQuarterlyReminders() calls now race cleanly via ON CONFLICT DO NOTHING.';
