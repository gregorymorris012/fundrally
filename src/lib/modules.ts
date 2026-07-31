"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Same reasoning as createFundraiser(): plain RLS INSERT policy
// ("org admins can create modules" in db/migrations/0007_phase2_policies.sql),
// no RPC needed. Only `type: "product"` is exercised anywhere in the app
// right now — see db/schema/modules.ts for why the other types aren't
// built yet.
// Shared by createProductModule (fundraiser detail page's "Enable product
// sale" button) and the onboarding wizard, which enables it automatically
// as part of creating a "Shop / Product Sale" fundraiser.
export async function createProductModuleCore(input: {
  orgId: string;
  fundraiserId: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("modules").insert({
    org_id: input.orgId,
    fundraiser_id: input.fundraiserId,
    type: "product",
    status: "active",
  });
  if (error) throw error;
}

export async function createProductModule(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const fundraiserId = String(formData.get("fundraiserId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));

  await createProductModuleCore({ orgId, fundraiserId });

  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}`);
}

// Active deviation (CLAUDE.md "Current deviations from the build spec"):
// chance-based types get backend + management UI now, gated by
// module_availability.enabled for that org+type — checked here in app
// code (an RLS-scoped read; org members can read module_availability),
// not left to the plain "org admins can create modules" policy alone,
// since that policy would otherwise let any admin create a chance module
// regardless of whether their org has it enabled. Starts in 'draft',
// unlike product's immediate 'active' — chance modules follow the full
// create -> configure -> launch -> manage -> close lifecycle; product
// doesn't model that yet.
const CHANCE_MODULE_TYPES = ["wheel", "squares", "fifty_fifty", "item_raffle"] as const;
type ChanceModuleType = (typeof CHANCE_MODULE_TYPES)[number];

export async function createChanceModuleCore(input: {
  orgId: string;
  fundraiserId: string;
  type: ChanceModuleType;
}) {
  if (!CHANCE_MODULE_TYPES.includes(input.type)) {
    throw new Error(`${input.type} is not a chance-based module type`);
  }

  const supabase = await createClient();
  const { data: availability } = await supabase
    .from("module_availability")
    .select("enabled")
    .eq("org_id", input.orgId)
    .eq("module_type", input.type)
    .maybeSingle();
  if (!availability?.enabled) {
    throw new Error(`${input.type} is not enabled for this organization`);
  }

  const { data, error } = await supabase
    .from("modules")
    .insert({
      org_id: input.orgId,
      fundraiser_id: input.fundraiserId,
      type: input.type,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function createModule(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const fundraiserId = String(formData.get("fundraiserId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const type = String(formData.get("type"));

  if (type === "product") {
    await createProductModuleCore({ orgId, fundraiserId });
  } else {
    await createChanceModuleCore({
      orgId,
      fundraiserId,
      type: type as ChanceModuleType,
    });
  }

  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}`);
}

// Module lifecycle (CLAUDE.md item 2 / build spec): create -> configure ->
// launch -> manage -> close. "configure"/"manage" aren't distinct status
// values — they're just working within 'draft'/'active' via this module's
// own management route. The status field only tracks the transitions an
// organizer explicitly triggers here, plus 'paused' as a reversible
// pre-close state. Uses the plain authenticated client: "org admins can
// update modules" (0007_phase2_policies.sql) already gates this via RLS.
const MODULE_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["active"],
  active: ["paused", "closed"],
  paused: ["active", "closed"],
  closed: [],
};

export async function updateModuleStatus(formData: FormData) {
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const nextStatus = String(formData.get("nextStatus"));

  const supabase = await createClient();
  const { data: mod, error: fetchError } = await supabase
    .from("modules")
    .select("status")
    .eq("id", moduleId)
    .maybeSingle();
  if (fetchError || !mod) throw new Error("module not found");
  if (!MODULE_STATUS_TRANSITIONS[mod.status]?.includes(nextStatus)) {
    throw new Error(`cannot move module from ${mod.status} to ${nextStatus}`);
  }

  const { error } = await supabase
    .from("modules")
    .update({ status: nextStatus })
    .eq("id", moduleId);
  if (error) throw error;

  revalidatePath(
    `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`,
  );
  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}`);
}

// Squares-only board labels (e.g. team names), stored in modules.config —
// unused by every other module type so far, so this replaces the whole
// object rather than merging keys into it. Plain RLS update ("org admins
// can update modules"), same as updateModuleStatus — no service role
// needed, this isn't a write path that bypasses a client policy.
export async function updateSquaresLabels(formData: FormData) {
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const rowLabel = String(formData.get("rowLabel") ?? "").trim().slice(0, 40);
  const colLabel = String(formData.get("colLabel") ?? "").trim().slice(0, 40);

  const supabase = await createClient();
  const { error } = await supabase
    .from("modules")
    .update({ config: { rowLabel, colLabel } })
    .eq("id", moduleId);
  if (error) throw error;

  revalidatePath(
    `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`,
  );
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
}
