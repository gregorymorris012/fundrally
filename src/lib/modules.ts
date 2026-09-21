"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgAdmin } from "@/lib/require-org-admin";
import {
  PERIODS_BY_STRUCTURE,
  type PayoutStructure,
  type SquaresConfig,
  type SquaresPeriod,
} from "@/lib/squares-config";
import {
  computePayouts,
  resolveRules,
  validateSplit,
  winningPosition,
} from "@/lib/squares-rules";

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
  name?: string | null;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("modules")
    .insert({
      org_id: input.orgId,
      fundraiser_id: input.fundraiserId,
      type: "product",
      status: "active",
      name: input.name?.trim().slice(0, 80) || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function createProductModule(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const fundraiserId = String(formData.get("fundraiserId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const name = String(formData.get("name") ?? "");

  await createProductModuleCore({ orgId, fundraiserId, name });

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
  name?: string | null;
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
      name: input.name?.trim().slice(0, 80) || null,
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
  const name = String(formData.get("name") ?? "");

  const created =
    type === "product"
      ? await createProductModuleCore({ orgId, fundraiserId, name })
      : await createChanceModuleCore({
          orgId,
          fundraiserId,
          type: type as ChanceModuleType,
          name,
        });

  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}`);
  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules`);
  // Land in the module just created (to configure it) instead of bouncing
  // back to the list and making the admin find it and click Manage.
  redirect(`/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${created.id}`);
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

// Mirrors deleteFundraiser (src/lib/fundraisers.ts): the "closed and no
// payment activity" rule is enforced in the RLS USING clause itself
// (0022_modules_delete_policy.sql), not a check-then-delete in app code —
// a DELETE blocked by that policy isn't an error, it just matches and
// deletes 0 rows, so the returned count is what turns "silently did
// nothing" into a clear message. Cascades through module_entries/draws
// (both onDelete: "cascade") — fine, since those are the free/no-money
// records this gate is specifically allowing (a module with any real
// transactions row can't reach 'closed'-and-deletable in the first place
// unless that transaction is voided, and even then the transaction row
// itself still exists and blocks the policy).
const MODULE_DELETE_BLOCKED_MESSAGE =
  "Can't delete a module unless it's closed with no payment activity.";

export async function deleteModuleCore(input: { moduleId: string }) {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("modules")
    .delete({ count: "exact" })
    .eq("id", input.moduleId);
  if (error) throw error;
  if (!count) throw new Error(MODULE_DELETE_BLOCKED_MESSAGE);
}

export async function deleteModule(formData: FormData) {
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));

  // The RLS policy refusing the delete is an expected outcome (the module
  // has payment activity), not a crash — bounce back to the module list
  // with a flag it turns into a message, rather than letting the throw
  // surface as Next's generic "This page couldn't load" error page.
  // redirect() throws, so it has to sit outside the try.
  let blocked = false;
  try {
    await deleteModuleCore({ moduleId });
  } catch (err) {
    if (err instanceof Error && err.message === MODULE_DELETE_BLOCKED_MESSAGE) {
      blocked = true;
    } else {
      throw err;
    }
  }
  if (blocked) {
    redirect(`/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules?deleteBlocked=1`);
  }

  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules`);
  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}`);
  // The page this action runs from (the module's own admin page) no
  // longer exists once the module is gone — same reasoning as
  // deleteFundraiser redirecting off the fundraiser page it ran from.
  redirect(`/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules`);
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const PAYOUT_STRUCTURES = ["final_only", "half_final", "quarters"] as const;

// Reads the current config so the board-settings/password/lock actions
// below can merge their own keys into it without clobbering keys another
// action owns (password/lock live in the same jsonb blob but are edited
// by separate forms — see the actions below).
async function readSquaresConfig(moduleId: string): Promise<SquaresConfig> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("modules")
    .select("config")
    .eq("id", moduleId)
    .maybeSingle();
  if (error || !data) throw new Error("module not found");
  return (data.config as SquaresConfig) ?? {};
}

// Board settings: team names/colors, price per square, payout structure.
// Merges into the existing config rather than overwriting it wholesale
// (unlike the old updateSquaresLabels) — password/locked/espnEventId are
// separate concerns living in the same jsonb blob and must survive this
// form's submit. Plain RLS update ("org admins can update modules"), same
// as updateModuleStatus — no service role needed, this isn't a write path
// that bypasses a client policy.
export async function updateSquaresBoard(formData: FormData) {
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const rowLabel = String(formData.get("rowLabel") ?? "").trim().slice(0, 40);
  const colLabel = String(formData.get("colLabel") ?? "").trim().slice(0, 40);
  const nameRaw = formData.get("name");
  const rowColorRaw = String(formData.get("rowColor") ?? "").trim();
  const colColorRaw = String(formData.get("colColor") ?? "").trim();
  const priceRaw = String(formData.get("pricePerSquare") ?? "").trim();

  if (rowColorRaw && !HEX_COLOR_RE.test(rowColorRaw)) {
    throw new Error("rowColor must be a #rrggbb hex value");
  }
  if (colColorRaw && !HEX_COLOR_RE.test(colColorRaw)) {
    throw new Error("colColor must be a #rrggbb hex value");
  }
  let pricePerSquareCents: number | undefined;
  if (priceRaw) {
    const cents = Math.round(Number(priceRaw) * 100);
    if (!Number.isInteger(cents) || cents < 0) {
      throw new Error("price per square must be a non-negative number");
    }
    pricePerSquareCents = cents;
  }

  const current = await readSquaresConfig(moduleId);
  const next: SquaresConfig = {
    ...current,
    rowLabel,
    colLabel,
    rowColor: rowColorRaw || undefined,
    colColor: colColorRaw || undefined,
    pricePerSquareCents,
    // Only the full board-settings form carries this checkbox; the ESPN
    // "Use this game" form doesn't, so absent means "leave it alone".
    showSquareNumbers:
      formData.get("showSquareNumbersPresent") != null
        ? formData.get("showSquareNumbers") === "on"
        : current.showSquareNumbers,
  };

  // name is a real column, not part of config (see db/schema/modules.ts).
  // Present on both the regular "Customize board" submit (a visible,
  // editable field) and the "Use this game" ESPN action (a hidden input
  // carrying the matched event's name) — absent only if some caller
  // forgets the field entirely, in which case leave the existing name
  // alone rather than blanking it.
  const updatePayload: { config: SquaresConfig; name?: string | null } = { config: next };
  if (nameRaw != null) {
    updatePayload.name = String(nameRaw).trim().slice(0, 80) || null;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("modules").update(updatePayload).eq("id", moduleId);
  if (error) throw error;

  revalidatePath(
    `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`,
  );
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);

  // Redirect rather than re-render in place: the page's ESPN search lives
  // in the URL (espnLeague/espnQuery), so staying put left the full list of
  // candidate games on screen after one was picked. Rebuilding the URL
  // drops those params, `boardSaved` triggers the confirmation banner, and
  // the hash keeps the admin at the Customize board card instead of the
  // top of a long page.
  redirect(
    `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}?tab=settings&boardSaved=1#customize-board`,
  );
}

// Separate action from updateSquaresBoard since it has a distinct input
// shape (write-only plaintext in, hash out — never round-trips a password
// back into a form defaultValue the way labels/colors do). Empty password
// clears the gate. This is a low-stakes access gate, not a security
// boundary — see the anon-readability caveat on SquaresConfig above and
// in db/schema/modules.ts.
export async function updateJoinPassword(formData: FormData) {
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const password = String(formData.get("password") ?? "");

  const current = await readSquaresConfig(moduleId);
  const next: SquaresConfig = {
    ...current,
    joinPasswordHash: password ? createHash("sha256").update(password).digest("hex") : null,
  };

  const supabase = await createClient();
  const { error } = await supabase.from("modules").update({ config: next }).eq("id", moduleId);
  if (error) throw error;

  revalidatePath(
    `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`,
  );
}

// Independent of the draft/active/paused/closed lifecycle status — stops
// new claims without pausing/closing the whole module. The modules-table
// write itself is a plain RLS update (doesn't need requireOrgAdmin, same
// as updateModuleStatus), but the audit_log insert has no client policy
// at all and no RLS to lean on, so requireOrgAdmin is called anyway for
// defense-in-depth rather than relying solely on the admin page hiding
// the button.
export async function toggleSquaresLock(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const locked = String(formData.get("locked")) === "true";

  const userId = await requireOrgAdmin(orgId);

  const current = await readSquaresConfig(moduleId);
  const next: SquaresConfig = { ...current, locked };

  const supabase = await createClient();
  const { error } = await supabase.from("modules").update({ config: next }).eq("id", moduleId);
  if (error) throw error;

  const admin = createServiceClient();
  await admin.from("audit_log").insert({
    org_id: orgId,
    actor: userId,
    action: locked ? "squares.locked" : "squares.unlocked",
    after: { module_id: moduleId },
  });

  revalidatePath(
    `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`,
  );
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
}

// Payout rules: structure (final only / halftime + final / every quarter +
// final), the fundraiser's share of the pot, and how the rest is split
// across the periods. Validated here, not just in the form's live total —
// the form is a convenience, this is the check. A rejected edit bounces
// back with the reason in the URL instead of throwing (which would show
// Next's generic error page). Writes an audit row since these numbers
// decide what winners are owed.
export async function updatePayoutRules(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const back = `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`;
  const fail = (message: string): never =>
    redirect(`${back}?tab=settings&payoutError=${encodeURIComponent(message)}#payouts`);

  const userId = await requireOrgAdmin(orgId);

  const structure = String(formData.get("payoutStructure")) as PayoutStructure;
  if (!PAYOUT_STRUCTURES.includes(structure)) fail("Choose a payout structure.");

  const charityPercent = Number(formData.get("charityPercent"));
  if (!Number.isFinite(charityPercent) || charityPercent < 0 || charityPercent > 100) {
    fail("The fundraiser's share must be between 0% and 100%.");
  }
  const charityBps = Math.round(charityPercent * 100);

  const splitBps: Partial<Record<SquaresPeriod, number>> = {};
  for (const period of PERIODS_BY_STRUCTURE[structure]) {
    const percent = Number(formData.get(`pct_${period}`));
    if (!Number.isFinite(percent)) fail("Every period needs a percentage.");
    splitBps[period] = Math.round(percent * 100);
  }
  const splitError = validateSplit(structure, splitBps);
  if (splitError) fail(splitError);

  const current = await readSquaresConfig(moduleId);
  const next: SquaresConfig = { ...current, payoutStructure: structure, charityBps, splitBps };

  const supabase = await createClient();
  const { error } = await supabase.from("modules").update({ config: next }).eq("id", moduleId);
  if (error) throw error;

  await createServiceClient().from("audit_log").insert({
    org_id: orgId,
    actor: userId,
    action: "squares.payout_rules_updated",
    after: { module_id: moduleId, structure, charity_bps: charityBps, split_bps: splitBps },
  });

  revalidatePath(back);
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
  redirect(`${back}?tab=settings&payoutsSaved=1#payouts`);
}

// Manual scoring: the organizer enters the score at the end of a period
// (top team = column, side team = row) and the winner is derived from the
// drawn numbers. Re-entering a period corrects it — each save is audited
// with the resulting winner and prize so the history is reconstructible.
// Prize amounts are bookkeeping only; the organizer settles payouts
// offline (FundRally never holds or moves prize money).
export async function saveSquaresScore(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const period = String(formData.get("period")) as SquaresPeriod;
  const back = `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`;
  const fail = (message: string): never =>
    redirect(`${back}?tab=grid&scoreError=${encodeURIComponent(message)}#scores`);

  const userId = await requireOrgAdmin(orgId);

  const current = await readSquaresConfig(moduleId);
  const rules = resolveRules(current);
  if (!rules.periods.includes(period)) fail("That period isn't part of this pool's payout structure.");

  const col = Number(formData.get("colScore"));
  const row = Number(formData.get("rowScore"));
  const valid = (n: number) => Number.isInteger(n) && n >= 0 && n <= 999;
  if (!valid(col) || !valid(row)) fail("Enter each score as a whole number, 0 or more.");

  const admin = createServiceClient();
  const { data: draw } = await admin
    .from("draws")
    .select("result")
    .eq("module_id", moduleId)
    .maybeSingle();
  if (!draw) fail("Draw the numbers before entering scores.");

  const position = winningPosition(
    draw!.result as { rowDigits: number[]; colDigits: number[] },
    { col, row },
  );
  const { data: holder } =
    position == null
      ? { data: null }
      : await admin
          .from("module_entries")
          .select("display_name")
          .eq("module_id", moduleId)
          .eq("position", position)
          .maybeSingle();

  const next: SquaresConfig = {
    ...current,
    scores: { ...current.scores, [period]: { col, row } },
  };
  const supabase = await createClient();
  const { error } = await supabase.from("modules").update({ config: next }).eq("id", moduleId);
  if (error) throw error;

  await admin.from("audit_log").insert({
    org_id: orgId,
    actor: userId,
    action: "square.score_entered",
    after: {
      module_id: moduleId,
      period,
      col_score: col,
      row_score: row,
      winning_position: position,
      winner_name: holder?.display_name ?? null,
      prize_cents: computePayouts(next)?.periods.find((p) => p.period === period)?.cents ?? null,
    },
  });

  revalidatePath(back);
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
  redirect(`${back}?tab=grid&scoreSaved=1#scores`);
}
