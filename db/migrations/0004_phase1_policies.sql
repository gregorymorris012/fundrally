-- Helper: is the current user an owner/admin of the given org? Same
-- SECURITY DEFINER shape as is_org_member() in 0001_rls_policies.sql, and
-- for the same reason (avoids self-referential RLS recursion on
-- memberships).
CREATE FUNCTION public.is_org_admin(check_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships
    WHERE org_id = check_org_id
      AND user_id = (SELECT auth.uid())
      AND role IN ('owner', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_org_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid) TO authenticated;

--> statement-breakpoint

-- fundraisers: unlike organizations/memberships, creating a fundraiser
-- happens when the actor already has a membership row in that org — there
-- is no bootstrapping problem, so this uses a normal RLS INSERT policy
-- (owner/admin only) instead of a SECURITY DEFINER RPC.
CREATE POLICY "org members can read fundraisers"
ON public.fundraisers
FOR SELECT
TO authenticated
USING (public.is_org_member(org_id));

CREATE POLICY "org admins can create fundraisers"
ON public.fundraisers
FOR INSERT
TO authenticated
WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY "org admins can update fundraisers"
ON public.fundraisers
FOR UPDATE
TO authenticated
USING (public.is_org_admin(org_id))
WITH CHECK (public.is_org_admin(org_id));

--> statement-breakpoint

-- participants: guest checkout must work without an account (build spec
-- section 4), so rows are written only by server code running as the
-- service role (see src/lib/payments/participants.ts) — there is no
-- client-side INSERT policy at all. Org members can read participants in
-- their own org.
CREATE POLICY "org members can read participants"
ON public.participants
FOR SELECT
TO authenticated
USING (public.is_org_member(org_id));

--> statement-breakpoint

-- transactions: written ONLY by the Stripe webhook handler via the
-- service role (build spec rule 3) — no client-side INSERT/UPDATE/DELETE
-- policy exists. Org members can read their own org's ledger.
CREATE POLICY "org members can read transactions"
ON public.transactions
FOR SELECT
TO authenticated
USING (public.is_org_member(org_id));

--> statement-breakpoint

-- audit_log: append-only, service-role-written only. Org members can read
-- their own org's audit trail; no client write policy of any kind.
CREATE POLICY "org members can read audit log"
ON public.audit_log
FOR SELECT
TO authenticated
USING (public.is_org_member(org_id));

--> statement-breakpoint

-- stripe_webhook_events: no client policy at all (not even SELECT) — raw
-- Stripe payloads are internal-only. Only the service role touches this
-- table; see the GRANTs below.

--> statement-breakpoint

-- Grants (see db/migrations/0002_grants.sql for why these are needed even
-- with RLS policies in place: object-level GRANT and row-level policy are
-- separate checks, and Drizzle-applied migrations don't inherit
-- Supabase's usual default privileges).
GRANT SELECT ON public.fundraisers TO authenticated;
GRANT SELECT ON public.participants TO authenticated;
GRANT SELECT ON public.transactions TO authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT INSERT, UPDATE ON public.fundraisers TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fundraisers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_webhook_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_log TO service_role;
