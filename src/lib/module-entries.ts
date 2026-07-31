"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";

const MAX_NAME_LENGTH = 100;

// Free, no-money participation record — see db/schema/module-entries.ts.
// Service role because module_entries has no client-side INSERT policy at
// all (same shape as guest checkout's participant creation): a public
// visitor has no session to scope an RLS policy to.
export async function joinModuleCore(input: {
  orgId: string;
  moduleId: string;
  displayName: string;
  note?: string | null;
}) {
  const displayName = input.displayName.trim().slice(0, MAX_NAME_LENGTH);
  if (!displayName) {
    throw new Error("name is required");
  }

  const admin = createServiceClient();
  const { error } = await admin.from("module_entries").insert({
    org_id: input.orgId,
    module_id: input.moduleId,
    display_name: displayName,
    note: input.note?.trim() || null,
  });
  if (error) throw error;
}

export async function joinModule(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const displayName = String(formData.get("displayName"));
  const note = String(formData.get("note") ?? "");

  await joinModuleCore({ orgId, moduleId, displayName, note });

  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
}
