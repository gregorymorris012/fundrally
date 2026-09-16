-- Mirrors 0016_delete_policies.sql's shape for fundraisers/organizations:
-- an org admin can delete a module only once it's closed AND has no real
-- payment activity against it, enforced in the USING clause itself (not
-- an app-level check-then-delete, which would have the same race window
-- every other check-then-write in this codebase avoids). A DELETE blocked
-- by this returns 0 rows affected rather than an error — deleteModule in
-- src/lib/modules.ts checks the returned count and raises a clear message
-- itself, same as deleteFundraiser/deleteOrganization already do.
CREATE POLICY "org admins can delete closed modules without payment activity"
ON public.modules
FOR DELETE
TO authenticated
USING (
  public.is_org_admin(org_id)
  AND status = 'closed'
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE transactions.module_id = modules.id
  )
);

--> statement-breakpoint

GRANT DELETE ON public.modules TO authenticated;
