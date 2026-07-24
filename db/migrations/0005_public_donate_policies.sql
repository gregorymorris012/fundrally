-- The donate page (build spec: guest checkout must work without an
-- account) is rendered for anonymous visitors, so `anon` needs to read
-- exactly the rows a public donate page needs: an active fundraiser and
-- its org's Stripe connection status. Nothing here is sensitive — a
-- Stripe *account id* (acct_...) is routinely used client-side and is not
-- a secret, unlike an API key.
CREATE POLICY "public can read active fundraisers"
ON public.fundraisers
FOR SELECT
TO anon
USING (status = 'active');

CREATE POLICY "public can read orgs with an active fundraiser"
ON public.organizations
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.fundraisers
    WHERE fundraisers.org_id = organizations.id
      AND fundraisers.status = 'active'
  )
);

GRANT SELECT ON public.fundraisers TO anon;
GRANT SELECT ON public.organizations TO anon;
