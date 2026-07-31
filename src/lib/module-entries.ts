"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";

const MAX_NAME_LENGTH = 100;
const UNIQUE_VIOLATION = "23505";

// Free, no-money participation record — see db/schema/module-entries.ts.
// Service role because module_entries has no client-side INSERT policy at
// all (same shape as guest checkout's participant creation): a public
// visitor has no session to scope an RLS policy to. `position` (0-99) is
// squares-only — the partial unique index in
// 0014_draws_and_squares_positions.sql is what actually stops two guests
// claiming the same square; the 23505 catch here just turns that into a
// readable error instead of a raw constraint-violation message.
export async function joinModuleCore(input: {
  orgId: string;
  moduleId: string;
  displayName: string;
  note?: string | null;
  position?: number | null;
}) {
  const displayName = input.displayName.trim().slice(0, MAX_NAME_LENGTH);
  if (!displayName) {
    throw new Error("name is required");
  }
  if (
    input.position != null &&
    (!Number.isInteger(input.position) || input.position < 0 || input.position > 99)
  ) {
    throw new Error("position must be between 0 and 99");
  }

  const admin = createServiceClient();
  const { error } = await admin.from("module_entries").insert({
    org_id: input.orgId,
    module_id: input.moduleId,
    display_name: displayName,
    note: input.note?.trim() || null,
    position: input.position ?? null,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error("that square is already taken — pick another");
    }
    throw error;
  }
}

export async function joinModule(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const displayName = String(formData.get("displayName"));
  const note = String(formData.get("note") ?? "");
  const positionRaw = formData.get("position");
  const position = positionRaw != null && positionRaw !== "" ? Number(positionRaw) : null;

  await joinModuleCore({ orgId, moduleId, displayName, note, position });

  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
}
