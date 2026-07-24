"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// No SECURITY DEFINER RPC needed here, unlike create_organization(): by
// the time someone can create a fundraiser they already have a membership
// row in that org, so the plain RLS INSERT policy ("org admins can create
// fundraisers" in db/migrations/0004_phase1_policies.sql) is sufficient —
// there's no bootstrapping problem to route around.
export async function createFundraiser(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const orgSlug = String(formData.get("orgSlug"));
  const title = String(formData.get("title"));
  const slug = String(formData.get("slug"));

  const supabase = await createClient();
  const { error } = await supabase.from("fundraisers").insert({
    org_id: orgId,
    title,
    slug,
    status: "active",
  });

  if (error) throw error;
  revalidatePath(`/org/${orgSlug}`);
}
