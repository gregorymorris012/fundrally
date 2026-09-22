-- 0014_draws_and_squares_positions.sql's "public can read active chance
-- modules" policy hardcodes the chance-module type list, and it predates
-- queen_of_hearts — without this, an anon visitor's read of a QoH module
-- row is filtered out by RLS, and since module_entries' and draws' own
-- anon-read policies check the module's visibility via an EXISTS subquery
-- against this same table (also RLS-enforced for the querying role), that
-- silently breaks the whole public page for the new type too, not just
-- the module row itself.
DROP POLICY "public can read active chance modules" ON public.modules;

CREATE POLICY "public can read active chance modules"
ON public.modules
FOR SELECT
TO anon
USING (
  status = 'active'
  AND type IN ('wheel', 'squares', 'fifty_fifty', 'item_raffle', 'queen_of_hearts')
  AND EXISTS (
    SELECT 1 FROM public.fundraisers
    WHERE fundraisers.id = modules.fundraiser_id
      AND fundraisers.status = 'active'
  )
);
