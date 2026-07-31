-- Partial unique index: stops two guests claiming the same square. NULL is
-- fine for raffle/50-50/wheel entries (Postgres never enforces uniqueness
-- across NULLs), so this only ever bites squares.
CREATE UNIQUE INDEX "module_entries_module_position_unique"
ON public.module_entries (module_id, position)
WHERE position IS NOT NULL;

--> statement-breakpoint

-- draws: no client INSERT/UPDATE/DELETE policy at all, same as audit_log —
-- build spec rule 2 (auditable randomness) means this table is written
-- once, by server code via the service role (src/lib/draws.ts), and never
-- touched again.
CREATE POLICY "org members can read draws"
ON public.draws
FOR SELECT
TO authenticated
USING (public.is_org_member(org_id));

-- Public entry page needs to show the drawn digits once a squares module
-- has been drawn, same anon-read shape as module_entries
-- (0012_module_entries_policies.sql).
CREATE POLICY "public can read draws for active modules"
ON public.draws
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.modules
    WHERE modules.id = draws.module_id
      AND modules.status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.fundraisers
        WHERE fundraisers.id = modules.fundraiser_id
          AND fundraisers.status = 'active'
      )
  )
);

--> statement-breakpoint

-- Grants (see db/migrations/0002_grants.sql for why these are needed even
-- with RLS policies in place).
GRANT SELECT ON public.draws TO authenticated;
GRANT SELECT ON public.draws TO anon;
GRANT SELECT, INSERT ON public.draws TO service_role;
