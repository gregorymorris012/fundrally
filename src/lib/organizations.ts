"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createOrganization(input: {
  name: string;
  slug: string;
  stateCode: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_organization", {
    p_name: input.name,
    p_slug: input.slug,
    p_state_code: input.stateCode,
  });

  if (error) throw error;
  return data as string;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Postgres unique_violation — organizations.slug has a unique constraint
// and neither the plain nor onboarding form shows the slug to the
// organizer (it's derived from the name, not typed in), so a collision
// has to be resolved automatically rather than surfaced as something for
// them to fix.
const UNIQUE_VIOLATION = "23505";

// Shared by createOrganizationAction (plain "/org/new" form) and the
// onboarding wizard's organization step — both just need "create an org
// from a name/state, picking a free slug" and differ only in where they
// redirect afterward.
export async function createOrganizationWithUniqueSlug(input: {
  name: string;
  stateCode: string;
}) {
  const baseSlug = slugify(input.name) || "org";

  let slug = baseSlug;
  for (let attempt = 0; ; attempt++) {
    try {
      const id = await createOrganization({
        name: input.name,
        slug,
        stateCode: input.stateCode,
      });
      return { id, slug };
    } catch (error) {
      const isSlugCollision =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === UNIQUE_VIOLATION;
      if (!isSlugCollision || attempt >= 4) throw error;
      slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    }
  }
}

export async function createOrganizationAction(formData: FormData) {
  const name = String(formData.get("name"));
  const stateCode = String(formData.get("stateCode"));
  const { slug } = await createOrganizationWithUniqueSlug({ name, stateCode });
  redirect(`/org/${slug}`);
}
