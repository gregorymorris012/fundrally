"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Same reasoning as createFundraiser(): plain RLS INSERT policy
// ("org admins can create modules" in db/migrations/0007_phase2_policies.sql),
// no RPC needed. Only `type: "product"` is exercised anywhere in the app
// right now — see db/schema/modules.ts for why the other types aren't
// built yet.
export async function createProductModule(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const fundraiserId = String(formData.get("fundraiserId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));

  const supabase = await createClient();
  const { error } = await supabase.from("modules").insert({
    org_id: orgId,
    fundraiser_id: fundraiserId,
    type: "product",
    status: "active",
  });

  if (error) throw error;
  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}`);
}
