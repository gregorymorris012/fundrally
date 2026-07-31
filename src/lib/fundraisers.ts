"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

// Shared by createFundraiser (org dashboard form) and the onboarding
// wizard's fundraiser-type step — both just need "create a fundraiser
// from a title, picking a free slug" and differ in what happens after.
// goalAmountCents is optional (nullable column) so the onboarding wizard,
// which doesn't ask for a goal up front, keeps working unchanged.
export async function createFundraiserWithUniqueSlug(input: {
  orgId: string;
  title: string;
  goalAmountCents?: number | null;
}) {
  const baseSlug = slugify(input.title) || "fundraiser";
  const supabase = await createClient();

  let slug = baseSlug;
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase
      .from("fundraisers")
      .insert({
        org_id: input.orgId,
        title: input.title,
        slug,
        status: "active",
        goal_amount_cents: input.goalAmountCents ?? null,
      })
      .select("id, slug")
      .single();
    if (!error) return data;
    if (error.code !== UNIQUE_VIOLATION || attempt >= 4) throw error;
    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
  }
}

export async function createFundraiser(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const orgSlug = String(formData.get("orgSlug"));
  const title = String(formData.get("title"));
  const goalRaw = formData.get("goal");
  const goalAmountCents =
    goalRaw != null && goalRaw !== "" ? Math.round(Number(goalRaw) * 100) : null;

  await createFundraiserWithUniqueSlug({ orgId, title, goalAmountCents });

  revalidatePath(`/org/${orgSlug}`);
}

// Plain RLS update ("org admins can update fundraisers",
// db/migrations/0004_phase1_policies.sql) — same shape as
// updateModuleStatus, no service role needed.
export async function updateFundraiserGoal(formData: FormData) {
  const fundraiserId = String(formData.get("fundraiserId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const goalRaw = formData.get("goal");
  const goalAmountCents =
    goalRaw != null && goalRaw !== "" ? Math.round(Number(goalRaw) * 100) : null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("fundraisers")
    .update({ goal_amount_cents: goalAmountCents })
    .eq("id", fundraiserId);
  if (error) throw error;

  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}`);
}

// The actual safety guarantee is the RLS policy itself ("org admins can
// delete fundraisers without payment activity",
// 0016_delete_policies.sql), which refuses to match the row at all if any
// transaction references it — this is not a check-then-delete in app
// code. A DELETE blocked by that USING clause isn't an error, though: it
// just matches and deletes 0 rows, so that's what gets checked here to
// turn "silently did nothing" into a clear message.
export async function deleteFundraiser(formData: FormData) {
  const fundraiserId = String(formData.get("fundraiserId"));
  const orgSlug = String(formData.get("orgSlug"));

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("fundraisers")
    .delete({ count: "exact" })
    .eq("id", fundraiserId);
  if (error) throw error;
  if (!count) {
    throw new Error(
      "Can't delete a fundraiser with payment activity — close it instead.",
    );
  }

  redirect(`/org/${orgSlug}`);
}
