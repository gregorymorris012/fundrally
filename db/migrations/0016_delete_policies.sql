-- Deleting a fundraiser or organization cascades everything under it
-- (modules, module_entries, draws, transactions, memberships — see the
-- onDelete: "cascade" chains in db/schema/*.ts), which would silently
-- destroy real ledger rows if allowed unconditionally. The "no payment
-- activity" rule is enforced HERE, in the USING clause, not just as an
-- app-level pre-check — a check-then-delete in application code has the
-- same race window every other check-then-write in this codebase has had
-- (see draws.ts), and this is exactly the kind of destructive action
-- where that gap matters most. A DELETE blocked by a USING clause returns
-- 0 rows affected rather than an error, so the app-level actions
-- (deleteFundraiser/deleteOrganization) check the returned count and
-- raise a clear error themselves.
CREATE POLICY "org admins can delete fundraisers without payment activity"
ON public.fundraisers
FOR DELETE
TO authenticated
USING (
  public.is_org_admin(org_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE transactions.fundraiser_id = fundraisers.id
  )
);

CREATE POLICY "org admins can delete organizations without payment activity"
ON public.organizations
FOR DELETE
TO authenticated
USING (
  public.is_org_admin(id)
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE transactions.org_id = organizations.id
  )
);

--> statement-breakpoint

GRANT DELETE ON public.fundraisers TO authenticated;
GRANT DELETE ON public.organizations TO authenticated;
