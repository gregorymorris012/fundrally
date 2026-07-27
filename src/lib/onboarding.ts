"use server";

import { redirect } from "next/navigation";
import { createOrganizationWithUniqueSlug } from "@/lib/organizations";
import { createFundraiserWithUniqueSlug } from "@/lib/fundraisers";
import { createProductModuleCore } from "@/lib/modules";

// Onboarding wizard step 2 ("What's your organization's name?") — same
// org-creation path as the plain "/org/new" form, just redirects into the
// next wizard step instead of straight to the org dashboard.
export async function createOrganizationOnboardingAction(formData: FormData) {
  const name = String(formData.get("name"));
  const stateCode = String(formData.get("stateCode"));

  const { slug } = await createOrganizationWithUniqueSlug({ name, stateCode });

  redirect(`/onboarding/fundraiser-type?org=${slug}`);
}

// Onboarding wizard step 4 ("Shop / Product Sale" selected) — creates the
// fundraiser AND enables its product module in one step, so the organizer
// lands straight on "add your first product" instead of hitting the
// separate "Enable product sale" button the plain fundraiser-detail page
// still needs (see lib/modules.ts).
export async function createShopFundraiserOnboardingAction(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const orgSlug = String(formData.get("orgSlug"));
  const title = String(formData.get("title"));

  const fundraiser = await createFundraiserWithUniqueSlug({ orgId, title });
  await createProductModuleCore({ orgId, fundraiserId: fundraiser.id });

  redirect(`/org/${orgSlug}/fundraisers/${fundraiser.slug}`);
}
