-- Table-level GRANTs. Discovered empirically: unlike tables created through
-- Supabase's own migration path, tables created by connecting directly as
-- `postgres` (which is how Drizzle Kit applies migrations) do NOT pick up
-- Supabase's usual default privileges. Without these, every query gets
-- "permission denied for table" regardless of RLS — RLS policies only
-- filter rows once a role already has the underlying object privilege.
--
-- authenticated: SELECT only, matching the SELECT-only policies in
-- 0001_rls_policies.sql — there is no INSERT/UPDATE/DELETE policy for
-- authenticated on either table, so granting those verbs would be inert
-- (WITH CHECK defaults to false), but omitting them keeps intent explicit.
--
-- service_role: full CRUD. It has BYPASSRLS, but that only skips policy
-- checks — it still needs the base object grant to touch the table at all.
GRANT SELECT ON public.organizations TO authenticated;
GRANT SELECT ON public.memberships TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships TO service_role;
