-- A resting state for a finished import.
--
-- Everything an import does is already written by the time the last row
-- is sorted: applying a row inserts a real monthly_expenses record and
-- the forecast reads that table, and the outstanding-items list derives
-- itself live from bank_transactions rather than from a flag anyone has
-- to remember to clear. So this is not plumbing. status = 'complete'
-- records that a human looked at an import with nothing unresolved left
-- and agreed, which is a different claim from the derived fact that no
-- row is unresolved, and worth keeping separately.
--
-- See docs/superpowers/specs/2026-08-06-import-completion-design.md.
--
-- Purely additive. No existing row is read, rewritten or re-statused by
-- this migration: the new enum value is not assigned to anything here,
-- and both columns arrive null. Reopening a completed import is a status
-- change back to 'reviewing', since nothing was destroyed to get here.

-- ADD VALUE IF NOT EXISTS is transaction-safe on PostgreSQL 12 and up as
-- long as the new label is not used in the same transaction, which it is
-- not: no statement below writes 'complete'.
alter type public.import_status add value if not exists 'complete';

alter table public.bank_imports
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references public.profiles(id);

comment on column public.bank_imports.completed_at is
  'When a human confirmed this import had nothing left unresolved. Null on every import that predates the Complete step, which is not the same as unfinished.';
comment on column public.bank_imports.completed_by is
  'Who confirmed it. status = complete is a user assertion; the derived fact is "no unresolved rows" and lives in summarizeImport, never in a stored counter.';
