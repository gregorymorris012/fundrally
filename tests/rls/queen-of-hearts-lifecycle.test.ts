import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestOrgWithFundraiser,
  serviceClient,
  signInTestUser,
} from "../helpers";
import {
  conductQueenOfHeartsDrawCore,
  enterQueenOfHeartsCore,
  markQueenOfHeartsEntryPaidCore,
  resolveQueenOfHeartsLivePickCore,
  shuffleQueenOfHeartsBoardCore,
  voidQueenOfHeartsEntryPaymentCore,
} from "@/lib/queen-of-hearts";
import { buildDeck, isQueenOfHearts } from "@/lib/queen-of-hearts-rules";
import type { QohCard, QohConfig } from "@/lib/queen-of-hearts-config";

// Covers the Queen of Hearts module against a real local database. Same
// boundary as squares-lifecycle.test.ts: every "use server" wrapper
// (enterQueenOfHearts, shuffleQueenOfHeartsBoard, etc.) calls
// src/lib/supabase/server.ts's createClient(), which needs a real Next.js
// request scope — this suite exercises the *Core functions directly
// (service-role only, no next/headers dependency) instead. Deterministic
// reveal-outcome scenarios (consolation vs. jackpot) bypass the real
// crypto-random shuffle and write a known board_shuffle draws row
// directly via the service client, the same "simulate the admin already
// set this" pattern squares' setConfig() helper uses.
//
// Only ONE real signed-in user (org A's owner, index 12 — see
// tests/helpers.ts's TEST_PHONES allocation), not two: every *Core
// function tested here uses the service role internally and takes a
// caller-supplied orgId + a plain actor-id string, not an authenticated
// session — so proving org-isolation ("org B can't touch org A's pool")
// only needs a second org row to exist, not a second real login. Org B is
// created via a direct service-role insert instead of
// createTestOrgWithFundraiser (which requires a real authenticated
// client to call the create_organization() RPC). The generic "org admins
// can update modules" RLS policy itself is already exercised end-to-end
// by squares-lifecycle.test.ts's equivalent test — it's the same policy
// for every module type, so it isn't re-tested here.
describe("queen of hearts lifecycle", () => {
  let userA: Awaited<ReturnType<typeof signInTestUser>>;
  let orgAId: string;
  let orgBId: string;
  let fundraiserAId: string;
  const cleanupOrgIds: string[] = [];

  beforeAll(async () => {
    userA = await signInTestUser(12);

    const suffix = randomUUID().slice(0, 8);
    const orgA = await createTestOrgWithFundraiser(userA, `qoh-a-${suffix}`);
    orgAId = orgA.orgId;
    fundraiserAId = orgA.fundraiserId;
    cleanupOrgIds.push(orgAId);

    const admin = serviceClient();
    const { data: orgB, error: orgBError } = await admin
      .from("organizations")
      .insert({ name: `Test Org B ${suffix}`, slug: `test-org-b-${suffix}`, state_code: "CA" })
      .select("id")
      .single();
    if (orgBError) throw orgBError;
    orgBId = orgB.id as string;
    cleanupOrgIds.push(orgBId);

    await admin.from("module_availability").insert({
      org_id: orgAId,
      module_type: "queen_of_hearts",
      enabled: true,
    });
  });

  afterAll(async () => {
    await serviceClient().from("organizations").delete().in("id", cleanupOrgIds);
  });

  async function createModule(orgId: string, fundraiserId: string, config: QohConfig = {}) {
    const { data, error } = await serviceClient()
      .from("modules")
      .insert({ org_id: orgId, fundraiser_id: fundraiserId, type: "queen_of_hearts", status: "active", config })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }

  // A fixed, known board: position 1 = Queen of Hearts, position 2 = 7 of
  // Spades (numbered tier), rest arbitrary. Inserted directly rather than
  // via the real crypto-random shuffle so reveal-outcome tests are
  // deterministic.
  function knownBoard(): QohCard[] {
    const deck = buildDeck();
    const qohIndex = deck.findIndex(isQueenOfHearts);
    [deck[0], deck[qohIndex]] = [deck[qohIndex], deck[0]];
    const sevenIndex = deck.findIndex((c) => c.type === "standard" && c.rank === "7" && c.suit === "Spades");
    [deck[1], deck[sevenIndex]] = [deck[sevenIndex], deck[1]];
    return deck;
  }

  async function insertKnownBoard(orgId: string, moduleId: string) {
    const { error } = await serviceClient().from("draws").insert({
      org_id: orgId,
      module_id: moduleId,
      segment: "board_shuffle",
      algorithm: "test fixture",
      inputs: {},
      result: { board: knownBoard() },
      actor: "test",
    });
    if (error) throw error;
  }

  it("won't shuffle without the organizer's compliance confirmation, and won't shuffle twice", async () => {
    const moduleId = await createModule(orgAId, fundraiserAId, { organizerConfirmedCompliance: false });
    await expect(
      shuffleQueenOfHeartsBoardCore({ orgId: orgAId, moduleId, actor: userA.userId }),
    ).rejects.toThrow(/permit\/registration/i);

    await serviceClient()
      .from("modules")
      .update({ config: { organizerConfirmedCompliance: true } })
      .eq("id", moduleId);

    const first = await shuffleQueenOfHeartsBoardCore({ orgId: orgAId, moduleId, actor: userA.userId });
    void first;
    const { data: draws } = await serviceClient()
      .from("draws")
      .select("result")
      .eq("module_id", moduleId)
      .eq("segment", "board_shuffle");
    expect(draws).toHaveLength(1);
    const board = draws![0].result.board as QohCard[];
    expect(board).toHaveLength(54);
    expect(board.filter(isQueenOfHearts)).toHaveLength(1);

    await expect(
      shuffleQueenOfHeartsBoardCore({ orgId: orgAId, moduleId, actor: userA.userId }),
    ).rejects.toThrow(/already been shuffled/i);
  });

  it("snapshots quantity x price at entry time, validates the number, and enforces one claim per number per cycle", async () => {
    const moduleId = await createModule(orgAId, fundraiserAId, { ticketPriceCents: 500 });

    await enterQueenOfHeartsCore({
      orgId: orgAId,
      moduleId,
      displayName: "  Ana Torres  ",
      cardNumber: 7,
      quantity: 3,
      confirmedAge18Plus: true,
    });

    const { data: entries } = await serviceClient()
      .from("module_entries")
      .select("display_name, cycle_number, card_number, quantity, price_cents")
      .eq("module_id", moduleId);
    expect(entries).toEqual([
      { display_name: "Ana Torres", cycle_number: 1, card_number: 7, quantity: 3, price_cents: 1500 },
    ]);

    // A later price change doesn't retroactively change what Ana's entry owes.
    await serviceClient().from("modules").update({ config: { ticketPriceCents: 999 } }).eq("id", moduleId);
    const { data: unchangedEntry } = await serviceClient()
      .from("module_entries")
      .select("price_cents")
      .eq("module_id", moduleId)
      .single();
    expect(unchangedEntry?.price_cents).toBe(1500);

    await expect(
      enterQueenOfHeartsCore({ orgId: orgAId, moduleId, displayName: "Ben", cardNumber: 7, confirmedAge18Plus: true }),
    ).rejects.toThrow(/already taken/i);
    await expect(
      enterQueenOfHeartsCore({ orgId: orgAId, moduleId, displayName: "Ben", cardNumber: 55, confirmedAge18Plus: true }),
    ).rejects.toThrow(/between 1 and 54/);
    await expect(
      enterQueenOfHeartsCore({ orgId: orgAId, moduleId, displayName: "Ben", cardNumber: 8, confirmedAge18Plus: false }),
    ).rejects.toThrow(/18\+/);
    await expect(
      enterQueenOfHeartsCore({ orgId: orgAId, moduleId, displayName: "  ", cardNumber: 8, confirmedAge18Plus: true }),
    ).rejects.toThrow(/name/i);
  });

  it("resolves an advance-pick winner immediately, pays a consolation prize, and rolls the cycle forward", async () => {
    const moduleId = await createModule(orgAId, fundraiserAId, {
      ticketPriceCents: 500,
      jackpotShareBps: 5000,
      prizeTable: { numbered: 1500, highFace: 2500, secondaryQueen: 5000, joker: 10000 },
    });
    await insertKnownBoard(orgAId, moduleId);
    // Position 2 (7 of Spades, "numbered") is the only entry this cycle, so
    // the weighted draw has exactly one possible outcome.
    await enterQueenOfHeartsCore({ orgId: orgAId, moduleId, displayName: "Cal", cardNumber: 2, confirmedAge18Plus: true });

    const result = await conductQueenOfHeartsDrawCore({ orgId: orgAId, moduleId, actor: userA.userId });
    expect(result).toMatchObject({ status: "RESOLVED", outcome: "CONSOLATION", revealedPosition: 2, tier: "numbered", prizeCents: 1500 });

    const { data: mod } = await serviceClient().from("modules").select("status, config").eq("id", moduleId).single();
    expect(mod?.status).toBe("active"); // consolation doesn't end the game
    expect((mod?.config as QohConfig).pendingDrawing ?? null).toBeNull();

    const { data: drawRows } = await serviceClient()
      .from("draws")
      .select("cycle_number, segment")
      .eq("module_id", moduleId)
      .eq("segment", "weekly_draw");
    expect(drawRows).toEqual([{ cycle_number: 1, segment: "weekly_draw" }]);

    // The next entry lands in cycle 2 — position 2 is permanently revealed,
    // so re-picking it is refused even in the new cycle.
    await expect(
      enterQueenOfHeartsCore({ orgId: orgAId, moduleId, displayName: "Dee", cardNumber: 5, confirmedAge18Plus: true }),
    ).resolves.toBeUndefined();
    const { data: cycle2Entry } = await serviceClient()
      .from("module_entries")
      .select("cycle_number")
      .eq("module_id", moduleId)
      .eq("display_name", "Dee")
      .single();
    expect(cycle2Entry?.cycle_number).toBe(2);
  });

  it("pauses on a day-of winner, blocks entries and a second draw, then resolves via the live pick and closes the game on the Queen", async () => {
    const moduleId = await createModule(orgAId, fundraiserAId, { ticketPriceCents: 500, jackpotSeedCents: 10_000 });
    await insertKnownBoard(orgAId, moduleId);
    // Only entry, no number chosen — guaranteed day-of winner.
    await enterQueenOfHeartsCore({ orgId: orgAId, moduleId, displayName: "Eli", confirmedAge18Plus: true });

    const pending = await conductQueenOfHeartsDrawCore({ orgId: orgAId, moduleId, actor: userA.userId });
    expect(pending).toMatchObject({ status: "AWAITING_LIVE_PICK", entryName: "Eli" });

    const { data: mod } = await serviceClient().from("modules").select("config").eq("id", moduleId).single();
    expect((mod?.config as QohConfig).pendingDrawing).toMatchObject({ cycleNumber: 1 });

    await expect(
      enterQueenOfHeartsCore({ orgId: orgAId, moduleId, displayName: "Fay", confirmedAge18Plus: true }),
    ).rejects.toThrow(/paused/i);
    await expect(
      conductQueenOfHeartsDrawCore({ orgId: orgAId, moduleId, actor: userA.userId }),
    ).rejects.toThrow(/hasn't chosen a number/i);

    // Eli picks position 1 live — the Queen of Hearts. Jackpot = the
    // $10,000 seed + 55% of Eli's own $5.00 entry (the default
    // jackpotShareBps) = $10,000 + $2.75 = $10,275.
    const resolved = await resolveQueenOfHeartsLivePickCore({ orgId: orgAId, moduleId, cardNumber: 1, actor: userA.userId });
    expect(resolved).toMatchObject({ outcome: "JACKPOT", revealedPosition: 1, payoutCents: 10_275, carryOverCents: 0 });

    const { data: closedMod } = await serviceClient().from("modules").select("status, config").eq("id", moduleId).single();
    expect(closedMod?.status).toBe("closed");
    expect((closedMod?.config as QohConfig).pendingDrawing ?? null).toBeNull();

    await expect(
      enterQueenOfHeartsCore({ orgId: orgAId, moduleId, displayName: "Gia", confirmedAge18Plus: true }),
    ).rejects.toThrow(/isn't open/i);
  });

  it("refuses a live pick of an already-revealed position", async () => {
    const moduleId = await createModule(orgAId, fundraiserAId, { ticketPriceCents: 500 });
    await insertKnownBoard(orgAId, moduleId);
    await enterQueenOfHeartsCore({ orgId: orgAId, moduleId, displayName: "Cal", cardNumber: 2, confirmedAge18Plus: true });
    await conductQueenOfHeartsDrawCore({ orgId: orgAId, moduleId, actor: userA.userId }); // reveals position 2, cycle -> 2

    await enterQueenOfHeartsCore({ orgId: orgAId, moduleId, displayName: "Hana", confirmedAge18Plus: true }); // day-of, cycle 2
    await conductQueenOfHeartsDrawCore({ orgId: orgAId, moduleId, actor: userA.userId }); // pauses on Hana

    await expect(
      resolveQueenOfHeartsLivePickCore({ orgId: orgAId, moduleId, cardNumber: 2, actor: userA.userId }),
    ).rejects.toThrow(/already been revealed/i);
  });

  it("marks an entry paid via a real offline-gift transaction tagged to the module, and voids it as a correction", async () => {
    const moduleId = await createModule(orgAId, fundraiserAId, { ticketPriceCents: 500 });
    await enterQueenOfHeartsCore({ orgId: orgAId, moduleId, displayName: "Ivy", cardNumber: 3, quantity: 2, confirmedAge18Plus: true });
    const { data: entry } = await serviceClient().from("module_entries").select("id").eq("module_id", moduleId).single();

    const { transactionId } = await markQueenOfHeartsEntryPaidCore({
      orgId: orgAId,
      fundraiserId: fundraiserAId,
      moduleId,
      entryId: entry!.id,
      method: "cash",
      enteredBy: userA.userId,
    });
    const { data: tx } = await serviceClient()
      .from("transactions")
      .select("kind, gross_cents, module_id")
      .eq("id", transactionId)
      .single();
    expect(tx).toMatchObject({ kind: "donation", gross_cents: 1000, module_id: moduleId });

    await expect(
      markQueenOfHeartsEntryPaidCore({ orgId: orgAId, fundraiserId: fundraiserAId, moduleId, entryId: entry!.id, method: "cash", enteredBy: userA.userId }),
    ).rejects.toThrow(/already marked paid/i);

    await voidQueenOfHeartsEntryPaymentCore({ orgId: orgAId, moduleId, entryId: entry!.id, enteredBy: userA.userId });
    const { data: adjustment } = await serviceClient()
      .from("transactions")
      .select("kind, gross_cents")
      .eq("adjusts_transaction_id", transactionId)
      .single();
    expect(adjustment).toMatchObject({ kind: "adjustment", gross_cents: -1000 });
  });

  it("scopes every Core action to the org it's called with — org B can't touch org A's pool", async () => {
    const moduleId = await createModule(orgAId, fundraiserAId, { ticketPriceCents: 500, organizerConfirmedCompliance: true });
    // A plain string, not a real org B session — these *Core functions never
    // authenticate `actor`, only record it (see the file header comment).
    const orgBActorId = randomUUID();

    await expect(
      shuffleQueenOfHeartsBoardCore({ orgId: orgBId, moduleId, actor: orgBActorId }),
    ).rejects.toThrow(/not found/i);
    await expect(
      conductQueenOfHeartsDrawCore({ orgId: orgBId, moduleId, actor: orgBActorId }),
    ).rejects.toThrow(/not found/i);
    await expect(
      enterQueenOfHeartsCore({ orgId: orgBId, moduleId, displayName: "Intruder", confirmedAge18Plus: true }),
    ).rejects.toThrow(/not found/i);

    const { data: leaked } = await serviceClient().from("module_entries").select("id").eq("module_id", moduleId);
    expect(leaked).toEqual([]);
  });

  it("logs admin/money/random actions to audit_log, but not a guest's own free entry", async () => {
    const moduleId = await createModule(orgAId, fundraiserAId, {
      ticketPriceCents: 500,
      organizerConfirmedCompliance: true,
    });
    await shuffleQueenOfHeartsBoardCore({ orgId: orgAId, moduleId, actor: userA.userId });
    // Not audited — same precedent as squares' joinModuleCore.
    await enterQueenOfHeartsCore({ orgId: orgAId, moduleId, displayName: "Jax", cardNumber: 1, confirmedAge18Plus: true });
    await conductQueenOfHeartsDrawCore({ orgId: orgAId, moduleId, actor: userA.userId });

    const { data: rows } = await serviceClient()
      .from("audit_log")
      .select("action")
      .eq("org_id", orgAId)
      .filter("after->>module_id", "eq", moduleId)
      .order("created_at", { ascending: true });
    expect(rows?.map((r) => r.action)).toEqual(["qoh.board_shuffled", "qoh.draw_resolved"]);
  });
});
