-- module_availability: same shape as modules — org members read, org
-- admins create/update via a plain RLS policy. No bootstrapping problem
-- (the actor already has a membership row), so no SECURITY DEFINER RPC
-- needed, same reasoning as modules/products.
CREATE POLICY "org members can read module availability"
ON public.module_availability
FOR SELECT
TO authenticated
USING (public.is_org_member(org_id));

CREATE POLICY "org admins can create module availability"
ON public.module_availability
FOR INSERT
TO authenticated
WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY "org admins can update module availability"
ON public.module_availability
FOR UPDATE
TO authenticated
USING (public.is_org_admin(org_id))
WITH CHECK (public.is_org_admin(org_id));

--> statement-breakpoint

-- Grants (see db/migrations/0002_grants.sql for why these are needed even
-- with RLS policies in place).
GRANT SELECT, INSERT, UPDATE ON public.module_availability TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.module_availability TO service_role;
