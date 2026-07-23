-- Helper: is the current user a member of the given org?
-- SECURITY DEFINER + owned by `postgres` (which has BYPASSRLS) so this can be
-- called from inside a `memberships`/`organizations` policy without the
-- self-referential recursion that a plain subquery on `memberships` would hit.
CREATE FUNCTION public.is_org_member(check_org_id uuid)
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
  );
$$;

REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;

--> statement-breakpoint

-- Atomically creates an org and its first membership (owner). This is the
-- only insert path into `organizations` / `memberships` in Phase 0 — see
-- build-spec rule 1 (server-authoritative outcomes). No client-side INSERT
-- policy exists on either table.
CREATE FUNCTION public.create_organization(
  p_name text,
  p_slug text,
  p_state_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'must be authenticated';
  END IF;

  INSERT INTO public.organizations (name, slug, state_code)
  VALUES (p_name, p_slug, p_state_code)
  RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org_id, (SELECT auth.uid()), 'owner');

  RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text) TO authenticated;

--> statement-breakpoint

-- organizations: a member can read their own org(s), nothing else. No
-- INSERT/UPDATE/DELETE policy exists for `authenticated` — all writes go
-- through create_organization() or the service role.
CREATE POLICY "org members can read their organization"
ON public.organizations
FOR SELECT
TO authenticated
USING (public.is_org_member(id));

--> statement-breakpoint

-- memberships: a user can always read their own membership rows, and can
-- read (but not write) fellow members' rows within an org they belong to.
CREATE POLICY "users can read their own membership rows"
ON public.memberships
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()) OR public.is_org_member(org_id));
