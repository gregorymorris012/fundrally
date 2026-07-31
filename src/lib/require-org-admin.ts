import { createClient } from "@/lib/supabase/server";

// Shared by anything that writes via the service role and therefore
// bypasses RLS entirely (offline gift entry, squares draws) — the actual
// gate those writes rely on, since the service role has no policy of its
// own to enforce it. Same check refundTransaction() in refund.ts does
// inline; pulled out here once it was needed in a second place.
export async function requireOrgAdmin(orgId: string): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("must be authenticated");

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    throw new Error("forbidden");
  }

  return user.id;
}
