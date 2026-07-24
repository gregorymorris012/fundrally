-- modules: same shape as fundraisers — org members read, org admins
-- create/update via a plain RLS policy (no bootstrapping problem, so no
-- SECURITY DEFINER RPC needed).
CREATE POLICY "org members can read modules"
ON public.modules
FOR SELECT
TO authenticated
USING (public.is_org_member(org_id));

CREATE POLICY "org admins can create modules"
ON public.modules
FOR INSERT
TO authenticated
WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY "org admins can update modules"
ON public.modules
FOR UPDATE
TO authenticated
USING (public.is_org_admin(org_id))
WITH CHECK (public.is_org_admin(org_id));

--> statement-breakpoint

-- products: same shape as modules.
CREATE POLICY "org members can read products"
ON public.products
FOR SELECT
TO authenticated
USING (public.is_org_member(org_id));

CREATE POLICY "org admins can create products"
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY "org admins can update products"
ON public.products
FOR UPDATE
TO authenticated
USING (public.is_org_admin(org_id))
WITH CHECK (public.is_org_admin(org_id));

--> statement-breakpoint

-- orders / order_items: written ONLY by server code — createOrderIntent
-- (service role, guest checkout has no session to scope an RLS policy to)
-- and the webhook handler (service role, rule 3). No client-side
-- INSERT/UPDATE/DELETE policy on either table, same as transactions.
-- Org members get read access for the admin-facing order history view.
CREATE POLICY "org members can read orders"
ON public.orders
FOR SELECT
TO authenticated
USING (public.is_org_member(org_id));

-- order_items has no org_id of its own (it's a pure line-item table), so
-- this checks tenancy through its parent order rather than duplicating
-- org_id onto every line item.
CREATE POLICY "org members can read order items"
ON public.order_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = order_items.order_id
      AND public.is_org_member(orders.org_id)
  )
);

--> statement-breakpoint

-- Public shop page (guest, no session) needs to read active product
-- modules and their active products — same reasoning as the fundraiser/org
-- exception in 0005_public_donate_policies.sql.
CREATE POLICY "public can read active product modules"
ON public.modules
FOR SELECT
TO anon
USING (
  status = 'active'
  AND type = 'product'
  AND EXISTS (
    SELECT 1 FROM public.fundraisers
    WHERE fundraisers.id = modules.fundraiser_id
      AND fundraisers.status = 'active'
  )
);

CREATE POLICY "public can read active products"
ON public.products
FOR SELECT
TO anon
USING (
  status = 'active'
  AND EXISTS (
    SELECT 1 FROM public.modules
    WHERE modules.id = products.module_id
      AND modules.status = 'active'
      AND modules.type = 'product'
  )
);

--> statement-breakpoint

-- Grants (see db/migrations/0002_grants.sql for why these are needed even
-- with RLS policies in place).
GRANT SELECT, INSERT, UPDATE ON public.modules TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.products TO authenticated;
GRANT SELECT ON public.orders TO authenticated;
GRANT SELECT ON public.order_items TO authenticated;

GRANT SELECT ON public.modules TO anon;
GRANT SELECT ON public.products TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.modules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO service_role;
