"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createProduct(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const name = String(formData.get("name"));
  const description = String(formData.get("description") ?? "");
  const priceCents = Math.round(Number(formData.get("price")) * 100);

  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    throw new Error("price must be a positive number");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert({
    org_id: orgId,
    module_id: moduleId,
    name,
    description: description || null,
    price_cents: priceCents,
    status: "active",
  });

  if (error) throw error;
  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}`);
}
