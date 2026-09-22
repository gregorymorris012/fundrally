-- 0014_draws_and_squares_positions.sql's "public can read active chance
-- modules" policy hardcodes the chance-module type list, and it predates
-- queen_of_hearts — without this, an anon visitor's read of a QoH module
-- row is filtered out by RLS, and since module_entries' and draws' own
-- anon-read policies check the module's visibility via an EXISTS subquery
-- against this same table (also RLS-enforced for the querying role), that
-- silently breaks the whole public page for the new type too, not just
-- the module row itself.
--
-- type::text, not a bare `type = ...` enum comparison: this migration runs
-- in the same drizzle-kit transaction as 0023 (which adds the
-- 'queen_of_hearts' enum value), and comparing a column against a
-- not-yet-committed enum literal fails with "unsafe use of new value ...
-- New enum values must be committed before they can be used" (Postgres
-- 55P04) — same class of bug as 0024's index predicates, see that file's
-- comment. Casting to text sidesteps it entirely: the right-hand side
-- literals are then plain text, never resolved against the enum's
-- pg_enum catalog, so no commit-visibility check applies.
DROP POLICY "public can read active chance modules" ON public.modules;

CREATE POLICY "public can read active chance modules"
ON public.modules
FOR SELECT
TO anon
USING (
  status = 'active'
  AND type::text IN ('wheel', 'squares', 'fifty_fifty', 'item_raffle', 'queen_of_hearts')
  AND EXISTS (
    SELECT 1 FROM public.fundraisers
    WHERE fundraisers.id = modules.fundraiser_id
      AND fundraisers.status = 'active'
  )
);
