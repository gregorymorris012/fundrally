-- payouts: read-only mirror of Stripe's own payout objects — no client
-- write policy of any kind, same as audit_log. Only the webhook handler
-- (service role) ever writes here.
CREATE POLICY "org members can read payouts"
ON public.payouts
FOR SELECT
TO authenticated
USING (public.is_org_member(org_id));

--> statement-breakpoint

-- Grants (see db/migrations/0002_grants.sql for why these are needed even
-- with RLS policies in place).
GRANT SELECT ON public.payouts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payouts TO service_role;
