"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// No SECURITY DEFINER RPC needed here, unlike create_organization(): by
// the time someone can create a fundraiser they already have a membership
// row in that org, so the plain RLS INSERT policy ("org admins can create
// fundraisers" in db/migrations/0004_phase1_policies.sql) is sufficient —
// there's no bootstrapping problem to route around.
function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Postgres unique_violation — fundraisers_org_slug_unique (org_id, slug)
// in db/schema/fundraisers.ts — and this form never shows the slug to the
// organizer (derived from the title, not typed in), so a collision has to
// be resolved automatically rather than surfaced as something for them to
// fix. Same pattern as createOrganizationAction in lib/organizations.ts.
const UNIQUE_VIOLATION = "23505";

export async function createFundraiser(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const orgSlug = String(formData.get("orgSlug"));
  const title = String(formData.get("title"));
  const baseSlug = slugify(title) || "fundraiser";

  const supabase = await createClient();

  let slug = baseSlug;
  for (let attempt = 0; ; attempt++) {
    const { error } = await supabase.from("fundraisers").insert({
      org_id: orgId,
      title,
      slug,
      status: "active",
    });
    if (!error) break;
    if (error.code !== UNIQUE_VIOLATION || attempt >= 4) throw error;
    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  revalidatePath(`/org/${orgSlug}`);
}
