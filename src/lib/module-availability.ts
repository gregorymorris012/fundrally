"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Same shape as createProductModuleCore: plain RLS INSERT/UPDATE policy
// gated to is_org_admin() (db/migrations/0010_module_availability_policies.sql)
// — the actor already has a membership row, so no SECURITY DEFINER RPC or
// service-role write is needed here, unlike offline-gift entry.
export async function setModuleAvailabilityCore(input: {
  orgId: string;
  moduleType: string;
  enabled: boolean;
}) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("module_availability")
    .upsert(
      { org_id: input.orgId, module_type: input.moduleType, enabled: input.enabled },
      { onConflict: "org_id,module_type" },
    );
  if (error) throw error;
}

export async function setModuleAvailability(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const orgSlug = String(formData.get("orgSlug"));
  const moduleType = String(formData.get("moduleType"));
  const enabled = String(formData.get("enabled")) === "true";

  await setModuleAvailabilityCore({ orgId, moduleType, enabled });

  revalidatePath(`/org/${orgSlug}`);
}
