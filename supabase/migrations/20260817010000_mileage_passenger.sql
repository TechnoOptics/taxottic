-- "I was a passenger": exclude a drive without destroying it.
--
-- The phone cannot tell driving from riding. A tracked drive where the
-- user was a passenger is not their mileage, and today the only ways to
-- deal with it are to file it personal (which is a lie about what the
-- trip was) or leave it business (which overstates a deduction).
--
-- WHY A CLASSIFICATION AND NOT A DELETE
--
-- The obvious ask is "remove it completely", and that is the wrong shape
-- for a tax record:
--
--   - A mis-tap would be unrecoverable. There is no undo for a hard
--     delete, and this is a one-tap control on a phone.
--   - It leaves a silent hole in the day's GPS trail. If anyone later
--     asks why there is a gap between two points, the evidence that
--     answers the question would be gone.
--   - This codebase already refuses to fabricate mileage. Quietly
--     destroying captured mileage is the same class of act pointed the
--     other way.
--
-- As a classification it behaves identically on screen (out of the list,
-- out of every total, zero deduction) and stays reversible.
--
-- tripDeductionCents() already returns 0 for anything that is not
-- "business", so the money side needs no change. What DOES need care is
-- that a passenger row must never carry a stale deduction from a prior
-- classification; reclassifyTripCore recomputes on every write, so that
-- is covered, and lib/mileage/deduction-invariants.ts gains a rule that
-- fails loudly if one ever appears.
--
-- ALTER TYPE ... ADD VALUE is allowed inside a transaction on PG12+, but
-- the new value cannot be USED in that same transaction. This migration
-- therefore only declares it; nothing here writes a passenger row.

alter type public.mileage_classification add value if not exists 'passenger';

comment on type public.mileage_classification is
  'business = deductible. personal = the driver''s own trip. '
  'unclassified = undecided. passenger = the user was riding, not '
  'driving: excluded from the log and every total, deduction always 0, '
  'row deliberately kept so the GPS trail has no unexplained gap.';
