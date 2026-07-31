-- module_entries: no client-side INSERT policy at all, same reasoning as
-- transactions/participants — the public join flow writes via the
-- service-role client (src/lib/module-entries.ts), not a client policy.
CREATE POLICY "org members can read module entries"
ON public.module_entries
FOR SELECT
TO authenticated
USING (public.is_org_member(org_id));

-- Public participation page needs to read entries for an active mini-game
-- under an active fundraiser, same shape as the product-module anon-read
-- exception in 0007_phase2_policies.sql.
CREATE POLICY "public can read entries for active modules"
ON public.module_entries
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.modules
    WHERE modules.id = module_entries.module_id
      AND modules.status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.fundraisers
        WHERE fundraisers.id = modules.fundraiser_id
          AND fundraisers.status = 'active'
      )
  )
);

--> statement-breakpoint

-- modules: the existing "public can read active product modules" policy
-- (0007_phase2_policies.sql) is scoped to type='product' only. Chance-based
-- types need their own anon-read policy for the public entry page to load
-- the module at all (title/type/status) — separate policy rather than
-- widening the product one, since it's a genuinely different condition
-- (any chance type, not just product).
CREATE POLICY "public can read active chance modules"
ON public.modules
FOR SELECT
TO anon
USING (
  status = 'active'
  AND type IN ('wheel', 'squares', 'fifty_fifty', 'item_raffle')
  AND EXISTS (
    SELECT 1 FROM public.fundraisers
    WHERE fundraisers.id = modules.fundraiser_id
      AND fundraisers.status = 'active'
  )
);

--> statement-breakpoint

-- Grants (see db/migrations/0002_grants.sql for why these are needed even
-- with RLS policies in place).
GRANT SELECT ON public.module_entries TO authenticated;
GRANT SELECT ON public.module_entries TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.module_entries TO service_role;
