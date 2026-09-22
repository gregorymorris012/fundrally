"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgAdmin } from "@/lib/require-org-admin";
import { addOfflineGiftCore, voidOfflineGiftCore } from "@/lib/payments/offline-gift";
import {
  AGE_MINIMUM,
  BOARD_SIZE,
  type QohCard,
  type QohConfig,
  type QohPrizeTable,
} from "@/lib/queen-of-hearts-config";
import {
  computeJackpotTotals,
  currentCycleNumber,
  cycleContestants,
  pickWeightedEntry,
  resolveDraw,
  resolveRules,
  revealedPositions as revealedPositionsOf,
  shuffleBoard,
  validateCardNumberSelection,
  type QohEntry,
  type WeeklyDrawSummary,
} from "@/lib/queen-of-hearts-rules";

const MAX_NAME_LENGTH = 100;
const UNIQUE_VIOLATION = "23505";

// A real, cryptographically-secure randomInt(maxExclusive) source — the
// only place in this file that supplies one to queen-of-hearts-rules.ts's
// randomness-requiring functions. Build spec rule 1 (crypto.randomInt,
// never Math.random) is enforced by shuffleBoard/pickWeightedEntry's
// required parameter, not by convention — see queen-of-hearts-rules.ts.
const cryptoRandomInt = (maxExclusive: number) => randomInt(maxExclusive);

// ---------------------------------------------------------------------------
// Shared loaders
// ---------------------------------------------------------------------------

// Service role, not the RLS-scoped client: every *Core function below is
// meant to be callable without a real Next.js request scope (same
// boundary as markSquarePaidCore/drawSquaresCore in module-entries.ts and
// draws.ts) — authorization is the caller's job (requireOrgAdmin() in
// each "use server" wrapper), not this read's.
async function loadModule(orgId: string, moduleId: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("modules")
    .select("id, org_id, status, type, config")
    .eq("id", moduleId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error || !data) throw new Error("pool not found");
  if (data.type !== "queen_of_hearts") throw new Error("not a Queen of Hearts pool");
  return { ...data, config: (data.config as QohConfig) ?? {} };
}

// Every weekly_draw row for this module, oldest first — the append-only
// history everything else (current cycle, revealed positions, jackpot
// total) is derived from.
async function loadWeeklyDraws(moduleId: string): Promise<WeeklyDrawSummary[]> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("draws")
    .select("result")
    .eq("module_id", moduleId)
    .eq("segment", "weekly_draw")
    .order("cycle_number", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row.result as { cycleNumber: number; outcome: "JACKPOT" | "CONSOLATION"; revealedPosition: number };
    return { cycleNumber: r.cycleNumber, outcome: r.outcome, revealedPosition: r.revealedPosition };
  });
}

// The one-time board_shuffle row's result — null before the board has been shuffled.
async function loadBoard(moduleId: string): Promise<QohCard[] | null> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("draws")
    .select("result")
    .eq("module_id", moduleId)
    .eq("segment", "board_shuffle")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return (data.result as { board: QohCard[] }).board;
}

// Every entry ever recorded for this module, across all cycles — needed
// for the running jackpot total (which grows across the whole game, not
// just one cycle). cycleContestants() (queen-of-hearts-rules.ts) narrows
// this to one cycle's weighted draw pool when that's what's needed.
async function loadAllEntries(moduleId: string): Promise<QohEntry[]> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("module_entries")
    .select("id, cycle_number, display_name, card_number, quantity")
    .eq("module_id", moduleId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((e) => ({
    id: e.id as string,
    cycleNumber: e.cycle_number as number,
    displayName: e.display_name,
    cardNumber: e.card_number,
    quantity: e.quantity,
  }));
}

async function writeAudit(
  orgId: string,
  actor: string,
  action: string,
  after: Record<string, unknown>,
) {
  await createServiceClient().from("audit_log").insert({ org_id: orgId, actor, action, after });
}

// ---------------------------------------------------------------------------
// Configuring the pool
// ---------------------------------------------------------------------------

const PRIZE_TIER_KEYS: (keyof QohPrizeTable)[] = ["joker", "secondaryQueen", "highFace", "numbered"];

// Ticket price, jackpot/fundraiser split, prize table, seed, and the
// organizer's compliance self-attestation. Plain RLS update ("org admins
// can update modules", 0007_phase2_policies.sql already covers every
// module type) — no service role needed, same as squares' board settings.
export async function updateQueenOfHeartsRules(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const base = `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`;
  const fail = (message: string): never =>
    redirect(`${base}?tab=settings&rulesError=${encodeURIComponent(message)}#rules`);

  const userId = await requireOrgAdmin(orgId);
  const mod = await loadModule(orgId, moduleId);

  const priceRaw = Number(formData.get("ticketPrice"));
  if (!Number.isFinite(priceRaw) || priceRaw <= 0) fail("Ticket price must be a positive amount.");
  const ticketPriceCents = Math.round(priceRaw * 100);

  const jackpotSharePercent = Number(formData.get("jackpotSharePercent"));
  if (!Number.isFinite(jackpotSharePercent) || jackpotSharePercent < 0 || jackpotSharePercent > 100) {
    fail("The jackpot's share must be between 0% and 100%.");
  }
  const jackpotShareBps = Math.round(jackpotSharePercent * 100);

  const absentPercent = Number(formData.get("jackpotPercentIfWinnerAbsent"));
  if (!Number.isFinite(absentPercent) || absentPercent < 0 || absentPercent > 100) {
    fail("The 'if the winner isn't present' payout must be between 0% and 100%.");
  }

  const prizeTable: Partial<QohPrizeTable> = {};
  for (const tier of PRIZE_TIER_KEYS) {
    const raw = Number(formData.get(`prize_${tier}`));
    if (!Number.isFinite(raw) || raw < 0) fail("Every prize amount must be zero or more.");
    prizeTable[tier] = Math.round(raw * 100);
  }

  const seedRaw = formData.get("jackpotSeed");
  const jackpotSeedCents = seedRaw && String(seedRaw).trim() ? Math.round(Number(seedRaw) * 100) : 0;
  if (!Number.isInteger(jackpotSeedCents) || jackpotSeedCents < 0) fail("The jackpot seed must be zero or more.");

  const organizerConfirmedCompliance = formData.get("organizerConfirmedCompliance") === "on";

  const next: QohConfig = {
    ...mod.config,
    ticketPriceCents,
    jackpotShareBps,
    jackpotPercentIfWinnerAbsentBps: Math.round(absentPercent * 100),
    prizeTable: { ...mod.config.prizeTable, ...prizeTable },
    jackpotSeedCents,
    showBoardNumbers: formData.get("showBoardNumbers") === "on",
    organizerConfirmedCompliance,
    organizerConfirmedComplianceAt: organizerConfirmedCompliance
      ? (mod.config.organizerConfirmedComplianceAt ?? new Date().toISOString())
      : undefined,
  };

  const supabase = await createClient();
  const { error } = await supabase.from("modules").update({ config: next }).eq("id", moduleId);
  if (error) throw error;

  await writeAudit(orgId, userId, "qoh.rules_updated", { module_id: moduleId });

  revalidatePath(base);
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
  redirect(`${base}?tab=settings&rulesSaved=1#rules`);
}

// ---------------------------------------------------------------------------
// Shuffling the board (once, ever, per module)
// ---------------------------------------------------------------------------

// Secretly assigns the 54-card deck to board positions. Requires the
// organizer's compliance confirmation first — this is the "start the
// game" moment, not bare module creation (which is generic across every
// chance type and has no compliance checkbox of its own). Build spec
// rule 2 (auditable randomness): the shuffle itself is the random
// outcome; it's written to `draws` (segment='board_shuffle') before
// anything else can depend on it, same as squares' digit draw.
export async function shuffleQueenOfHeartsBoardCore(input: { orgId: string; moduleId: string; actor: string }) {
  const mod = await loadModule(input.orgId, input.moduleId);
  if (!mod.config.organizerConfirmedCompliance) {
    throw new Error(
      "Confirm you've handled any required charitable-gaming permit/registration for this jurisdiction first (Settings).",
    );
  }

  const admin = createServiceClient();
  const { count: existing } = await admin
    .from("draws")
    .select("id", { count: "exact", head: true })
    .eq("module_id", input.moduleId)
    .eq("segment", "board_shuffle");
  if (existing && existing > 0) throw new Error("the board has already been shuffled");

  const board = shuffleBoard(cryptoRandomInt);

  const { error } = await admin.from("draws").insert({
    org_id: input.orgId,
    module_id: input.moduleId,
    segment: "board_shuffle",
    algorithm: "crypto.randomInt fisher-yates, 54-card deck shuffled once",
    inputs: { boardSize: BOARD_SIZE },
    result: { board },
    actor: input.actor,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new Error("the board has already been shuffled");
    throw error;
  }

  await writeAudit(input.orgId, input.actor, "qoh.board_shuffled", { module_id: input.moduleId });
}

export async function shuffleQueenOfHeartsBoard(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));

  const userId = await requireOrgAdmin(orgId);
  await shuffleQueenOfHeartsBoardCore({ orgId, moduleId, actor: userId });

  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`);
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
}

// ---------------------------------------------------------------------------
// Entering (free demo participation — see db/schema/module-entries.ts)
// ---------------------------------------------------------------------------

// Free entry for the module's current open cycle. Service role, same
// reasoning as joinModuleCore: a guest has no session, and validating
// against the module's live config/entries has to happen server-side
// regardless. price_cents snapshots quantity * the configured ticket
// price at entry time — the entry's total, not a per-unit price (unlike
// squares' price_cents, which is per-square) — so a later price change
// never retroactively changes what an already-recorded entry owes.
//
// markPaid/method/fundraiserId are for the organizer's own "add an
// in-person entry" panel (QohAdminBoard) — someone paid cash on the spot,
// so it's recorded and marked paid in one step, mirroring
// assignSquareCore. The public entry form never sets these. A failed
// paid-mark is reported, not rolled back — the entry still exists and can
// be marked paid separately.
export async function enterQueenOfHeartsCore(input: {
  orgId: string;
  moduleId: string;
  displayName: string;
  note?: string | null;
  cardNumber?: number | null;
  quantity?: number;
  confirmedAge18Plus: boolean;
  markPaid?: boolean;
  method?: "cash" | "check" | "in_kind" | "other";
  fundraiserId?: string;
  actor?: string; // required if markPaid is true (attributed to whoever recorded the cash)
}): Promise<{ entryId: string; paidError: string | null }> {
  const displayName = input.displayName.trim().slice(0, MAX_NAME_LENGTH);
  if (!displayName) throw new Error("name is required");
  if (input.confirmedAge18Plus !== true) {
    throw new Error(`Confirm you're ${AGE_MINIMUM}+ before entering.`);
  }
  const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1));

  const admin = createServiceClient();
  const { data: mod, error: modError } = await admin
    .from("modules")
    .select("status, config")
    .eq("id", input.moduleId)
    .eq("org_id", input.orgId)
    .eq("type", "queen_of_hearts")
    .maybeSingle();
  if (modError || !mod) throw new Error("pool not found");
  if (mod.status !== "active") throw new Error("this pool isn't open for entries");
  const config = (mod.config as QohConfig) ?? {};
  if (config.pendingDrawing) {
    throw new Error("entries are paused until this week's live pick is resolved");
  }

  const weeklyDraws = await loadWeeklyDraws(input.moduleId);
  const cycle = currentCycleNumber(weeklyDraws);
  if (cycle === "completed") throw new Error("this game has already ended");

  const cardNumber = input.cardNumber ?? null;
  if (cardNumber != null) {
    const { data: claimed } = await admin
      .from("module_entries")
      .select("card_number")
      .eq("module_id", input.moduleId)
      .eq("cycle_number", cycle)
      .not("card_number", "is", null);
    validateCardNumberSelection(cardNumber, new Set((claimed ?? []).map((c) => c.card_number as number)));
  }

  const rules = resolveRules(config);
  const priceCents = quantity * rules.ticketPriceCents;

  const { data: inserted, error } = await admin
    .from("module_entries")
    .insert({
      org_id: input.orgId,
      module_id: input.moduleId,
      display_name: displayName,
      note: input.note?.trim() || null,
      cycle_number: cycle,
      card_number: cardNumber,
      quantity,
      price_cents: priceCents,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error(`number ${cardNumber} is already taken this cycle — pick another`);
    }
    throw error;
  }
  const entryId = inserted!.id as string;
  // Not audited, same precedent as squares' joinModuleCore: a guest's own
  // free entry isn't a money-touching or random/admin outcome (rule 5).
  // Admin-driven actions on this data (mark paid, void, the draw itself)
  // are audited below.

  let paidError: string | null = null;
  if (input.markPaid) {
    if (!input.fundraiserId || !input.actor) throw new Error("fundraiserId and actor are required to mark paid");
    try {
      await markQueenOfHeartsEntryPaidCore({
        orgId: input.orgId,
        fundraiserId: input.fundraiserId,
        moduleId: input.moduleId,
        entryId,
        method: input.method ?? "cash",
        enteredBy: input.actor,
      });
    } catch (err) {
      paidError = err instanceof Error ? err.message : "couldn't mark it paid";
    }
  }
  return { entryId, paidError };
}

// Public-facing entry form. No auth (guests have no session), no
// markPaid support (that's the admin-only path below), no redirect —
// matches joinModule's shape.
export async function enterQueenOfHearts(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const displayName = String(formData.get("displayName") ?? "");
  const note = String(formData.get("note") ?? "");
  const cardNumberRaw = formData.get("cardNumber");
  const cardNumber = cardNumberRaw != null && cardNumberRaw !== "" ? Number(cardNumberRaw) : null;
  const quantity = Number(formData.get("quantity") ?? 1);
  const confirmedAge18Plus = formData.get("confirmedAge18Plus") === "on";

  await enterQueenOfHeartsCore({
    orgId,
    moduleId,
    displayName,
    note,
    cardNumber,
    quantity,
    confirmedAge18Plus,
  });

  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`);
}

// Organizer's "add an in-person entry" panel (QohAdminBoard) — someone
// paid cash on the spot; optionally marks it paid in the same step.
// Mirrors assignSquareAsAdmin's shape: admin-gated, errors bounce back
// with a message in the URL instead of throwing (Next's generic error
// page would be a bad outcome from an inline panel).
export async function addQueenOfHeartsEntryAsAdmin(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const fundraiserId = String(formData.get("fundraiserId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const back = `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`;
  const displayName = String(formData.get("displayName") ?? "");
  const cardNumberRaw = formData.get("cardNumber");
  const cardNumber = cardNumberRaw != null && cardNumberRaw !== "" ? Number(cardNumberRaw) : null;
  const quantity = Number(formData.get("quantity") ?? 1);
  const markPaid = formData.get("markPaid") === "on";
  const method = String(formData.get("method") ?? "cash") as "cash" | "check" | "in_kind" | "other";

  const userId = await requireOrgAdmin(orgId);

  let failure: string | null = null;
  try {
    const { paidError } = await enterQueenOfHeartsCore({
      orgId,
      moduleId,
      displayName,
      cardNumber,
      quantity,
      confirmedAge18Plus: true, // the organizer is attesting on the buyer's behalf, recording an in-person sale
      markPaid,
      method,
      fundraiserId,
      actor: userId,
    });
    if (paidError) {
      failure = `Entry added, but it couldn't be marked paid: ${paidError}`;
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : "Something went wrong.";
  }

  revalidatePath(back);
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
  if (failure) {
    redirect(`${back}?tab=grid&entryError=${encodeURIComponent(failure)}#board`);
  }
  redirect(`${back}?tab=grid&entryAdded=1#board`);
}

// ---------------------------------------------------------------------------
// Recording a real, in-person payment against an entry
// ---------------------------------------------------------------------------

async function fetchEntry(orgId: string, moduleId: string, entryId: string) {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("module_entries")
    .select("id, display_name, card_number, quantity, price_cents, transaction_id")
    .eq("id", entryId)
    .eq("module_id", moduleId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error || !data) throw new Error("entry not found");
  return data;
}

// Reuses addOfflineGiftCore — the required reuse point per CLAUDE.md's
// ledger rules, same as markSquarePaidCore. module_entries stays the
// free/no-money record; this just links it to the real ledger row.
export async function markQueenOfHeartsEntryPaidCore(input: {
  orgId: string;
  fundraiserId: string;
  moduleId: string;
  entryId: string;
  method: "cash" | "check" | "in_kind" | "other";
  enteredBy: string;
}) {
  const entry = await fetchEntry(input.orgId, input.moduleId, input.entryId);
  if (entry.transaction_id) throw new Error("already marked paid — void it first to correct");
  if (!entry.price_cents) throw new Error("this entry has no price recorded, nothing to collect");

  const transaction = await addOfflineGiftCore({
    orgId: input.orgId,
    fundraiserId: input.fundraiserId,
    moduleId: input.moduleId,
    donorName: entry.display_name,
    amountCents: entry.price_cents,
    method: input.method,
    receivedAt: new Date().toISOString(),
    reference: `Queen of Hearts entry x${entry.quantity}`,
    enteredBy: input.enteredBy,
  });

  const admin = createServiceClient();
  const { error } = await admin
    .from("module_entries")
    .update({ transaction_id: transaction.id })
    .eq("id", input.entryId);
  if (error) throw error;

  await writeAudit(input.orgId, input.enteredBy, "qoh.entry_paid", {
    module_id: input.moduleId,
    entry_id: input.entryId,
    transaction_id: transaction.id,
    amount_cents: entry.price_cents,
  });

  return { transactionId: transaction.id as string };
}

export async function markQueenOfHeartsEntryPaid(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const fundraiserId = String(formData.get("fundraiserId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const entryId = String(formData.get("entryId"));
  const method = String(formData.get("method")) as "cash" | "check" | "in_kind" | "other";

  const userId = await requireOrgAdmin(orgId);
  await markQueenOfHeartsEntryPaidCore({ orgId, fundraiserId, moduleId, entryId, method, enteredBy: userId });

  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`);
}

// Mirrors voidSquarePaymentCore: a kind='adjustment' correction row, per
// the ledger's never-edit-in-place rule — void does not remove the entry.
export async function voidQueenOfHeartsEntryPaymentCore(input: {
  orgId: string;
  moduleId: string;
  entryId: string;
  enteredBy: string;
}) {
  const entry = await fetchEntry(input.orgId, input.moduleId, input.entryId);
  if (!entry.transaction_id) throw new Error("this entry isn't marked paid");

  await voidOfflineGiftCore({ orgId: input.orgId, transactionId: entry.transaction_id, enteredBy: input.enteredBy });

  const admin = createServiceClient();
  const { error } = await admin
    .from("module_entries")
    .update({ transaction_id: null })
    .eq("id", input.entryId);
  if (error) throw error;

  await writeAudit(input.orgId, input.enteredBy, "qoh.entry_payment_voided", {
    module_id: input.moduleId,
    entry_id: input.entryId,
    voided_transaction_id: entry.transaction_id,
  });
}

export async function voidQueenOfHeartsEntryPayment(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const entryId = String(formData.get("entryId"));

  const userId = await requireOrgAdmin(orgId);
  await voidQueenOfHeartsEntryPaymentCore({ orgId, moduleId, entryId, enteredBy: userId });

  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`);
}

// ---------------------------------------------------------------------------
// The weekly drawing
// ---------------------------------------------------------------------------

async function jackpotBeforeCents(moduleId: string, config: QohConfig): Promise<number> {
  const entries = await loadAllEntries(moduleId);
  const rules = resolveRules(config);
  return computeJackpotTotals(rules, entries, config.jackpotSeedCents ?? 0).jackpotCents;
}

// Picks this cycle's winning entry, weighted by quantity — the "random
// name drawn" moment. If the entry already has a number, resolves and
// writes the weekly_draw row immediately (build spec rule 2: the pick
// itself is the audited random outcome, and it's written atomically with
// its resolution since there's nothing left undecided). If it's a
// "day-of" entry, pauses on modules.config.pendingDrawing instead — draws
// stays append-only (no UPDATE grant for service_role on that table), so
// nothing is written there until resolveQueenOfHeartsLivePick knows the
// final card number.
export async function conductQueenOfHeartsDrawCore(input: { orgId: string; moduleId: string; actor: string }) {
  const mod = await loadModule(input.orgId, input.moduleId);
  if (mod.config.pendingDrawing) {
    throw new Error("this week's drawing already picked a winner who hasn't chosen a number yet");
  }

  const board = await loadBoard(input.moduleId);
  if (!board) throw new Error("shuffle the board before drawing");

  const weeklyDraws = await loadWeeklyDraws(input.moduleId);
  const cycle = currentCycleNumber(weeklyDraws);
  if (cycle === "completed") throw new Error("this game has already ended");

  const entries = await loadAllEntries(input.moduleId);
  const { weightedIds } = cycleContestants(entries, cycle);
  if (weightedIds.length === 0) throw new Error("no entries have been recorded for this cycle yet");

  const winningEntryId = pickWeightedEntry(weightedIds, cryptoRandomInt);
  const winningEntry = entries.find((e) => e.id === winningEntryId)!;

  if (winningEntry.cardNumber == null) {
    const admin = createServiceClient();
    const nextConfig: QohConfig = { ...mod.config, pendingDrawing: { cycleNumber: cycle, entryId: winningEntryId } };
    const { error } = await admin.from("modules").update({ config: nextConfig }).eq("id", input.moduleId);
    if (error) throw error;
    await writeAudit(input.orgId, input.actor, "qoh.draw_awaiting_live_pick", {
      module_id: input.moduleId,
      cycle_number: cycle,
      entry_id: winningEntryId,
      entry_name: winningEntry.displayName,
    });
    return {
      status: "AWAITING_LIVE_PICK" as const,
      cycleNumber: cycle,
      entryId: winningEntryId,
      entryName: winningEntry.displayName,
    };
  }

  const result = await resolveAndRecordDraw({
    orgId: input.orgId,
    moduleId: input.moduleId,
    actor: input.actor,
    cycleNumber: cycle,
    winningEntryId,
    cardNumber: winningEntry.cardNumber,
    board,
    config: mod.config,
    weeklyDraws,
  });
  return { status: "RESOLVED" as const, ...result };
}

export async function conductQueenOfHeartsDraw(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const back = `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`;

  const userId = await requireOrgAdmin(orgId);
  try {
    await conductQueenOfHeartsDrawCore({ orgId, moduleId, actor: userId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    redirect(`${back}?tab=grid&drawError=${encodeURIComponent(message)}#draw`);
  }

  revalidatePath(back);
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
  redirect(`${back}?tab=grid&drawResolved=1#draw`);
}

// Finish a drawing that's waiting on a live number pick — call once the
// winner has said, live, which still-open number they want revealed.
export async function resolveQueenOfHeartsLivePickCore(input: {
  orgId: string;
  moduleId: string;
  cardNumber: number;
  actor: string;
}) {
  const mod = await loadModule(input.orgId, input.moduleId);
  const pending = mod.config.pendingDrawing;
  if (!pending) throw new Error("no drawing is currently waiting on a live pick");

  if (!Number.isInteger(input.cardNumber) || input.cardNumber < 1 || input.cardNumber > BOARD_SIZE) {
    throw new Error(`Pick a number between 1 and ${BOARD_SIZE}.`);
  }

  const board = await loadBoard(input.moduleId);
  if (!board) throw new Error("the board hasn't been shuffled"); // shouldn't happen — a draw can't start without it
  const weeklyDraws = await loadWeeklyDraws(input.moduleId);
  if (revealedPositionsOf(weeklyDraws).has(input.cardNumber)) {
    throw new Error(`Position ${input.cardNumber} has already been revealed — pick a still-open number.`);
  }

  const entries = await loadAllEntries(input.moduleId);
  const winningEntry = entries.find((e) => e.id === pending.entryId);
  if (!winningEntry) throw new Error("the pending winning entry could not be found");

  const result = await resolveAndRecordDraw({
    orgId: input.orgId,
    moduleId: input.moduleId,
    actor: input.actor,
    cycleNumber: pending.cycleNumber,
    winningEntryId: pending.entryId,
    cardNumber: input.cardNumber,
    board,
    config: mod.config,
    weeklyDraws,
    clearPendingDrawing: true,
  });
  return result;
}

export async function resolveQueenOfHeartsLivePick(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const back = `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`;
  const cardNumber = Number(formData.get("cardNumber"));

  const userId = await requireOrgAdmin(orgId);
  try {
    await resolveQueenOfHeartsLivePickCore({ orgId, moduleId, cardNumber, actor: userId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    redirect(`${back}?tab=grid&drawError=${encodeURIComponent(message)}#draw`);
  }

  revalidatePath(back);
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
  redirect(`${back}?tab=grid&drawResolved=1#draw`);
}

// Shared tail of both draw paths above: run the pure resolveDraw() math,
// write the one immutable weekly_draw row it produces, clear
// pendingDrawing if this resolved one, and close the module if the Queen
// of Hearts was just revealed. No randomness here — by the time this
// runs, the winning entry and its number are both already decided.
async function resolveAndRecordDraw(input: {
  orgId: string;
  moduleId: string;
  actor: string;
  cycleNumber: number;
  winningEntryId: string;
  cardNumber: number;
  board: QohCard[];
  config: QohConfig;
  weeklyDraws: WeeklyDrawSummary[];
  clearPendingDrawing?: boolean;
}) {
  const rules = resolveRules(input.config);
  const before = await jackpotBeforeCents(input.moduleId, input.config);

  const draw = resolveDraw({
    cycleNumber: input.cycleNumber,
    winningEntryId: input.winningEntryId,
    cardNumber: input.cardNumber,
    board: input.board,
    revealedPositions: revealedPositionsOf(input.weeklyDraws),
    rules,
    jackpotBeforeCents: before,
  });

  const admin = createServiceClient();
  const { error: drawError } = await admin.from("draws").insert({
    org_id: input.orgId,
    module_id: input.moduleId,
    segment: "weekly_draw",
    cycle_number: input.cycleNumber,
    algorithm: "crypto.randomInt weighted pick by entry quantity; reveal/prize math is pure derivation",
    inputs: { cycleNumber: input.cycleNumber },
    result: draw,
    actor: input.actor,
  });
  if (drawError) throw drawError;

  const nextConfig: QohConfig = input.clearPendingDrawing
    ? { ...input.config, pendingDrawing: null }
    : input.config;
  const updatePayload: { config: QohConfig; status?: string } = { config: nextConfig };
  if (draw.outcome === "JACKPOT") updatePayload.status = "closed";
  const { error: updateError } = await admin.from("modules").update(updatePayload).eq("id", input.moduleId);
  if (updateError) throw updateError;

  await writeAudit(input.orgId, input.actor, "qoh.draw_resolved", {
    module_id: input.moduleId,
    cycle_number: input.cycleNumber,
    outcome: draw.outcome,
    revealed_position: draw.revealedPosition,
    prize_cents: draw.prizeCents ?? draw.payoutCents ?? null,
  });

  return draw;
}
