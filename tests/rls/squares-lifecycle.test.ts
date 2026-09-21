import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestOrgWithFundraiser,
  serviceClient,
  signInTestUser,
} from "../helpers";
import {
  assignSquareCore,
  joinModuleCore,
  markSquarePaidCore,
  voidSquarePaymentCore,
  releaseSquareCore,
  releaseStaleSquaresCore,
} from "@/lib/module-entries";
import { drawSquaresCore } from "@/lib/draws";
import type { SquaresConfig } from "@/lib/squares-config";

// Covers the squares-module additions (payment tracking, join password,
// lock, single number draw, activity log) against a real local database.
//
// Scope note: updateSquaresBoard/updateJoinPassword/toggleSquaresLock and
// every "use server" wrapper action (markSquarePaid, voidSquarePayment,
// releaseSquare, drawSquares, etc.) call src/lib/supabase/server.ts's
// createClient(), which reads next/headers' cookies() — that throws
// outside a real Next.js request scope, so (same as every other "use
// server" wrapper in this codebase — none are unit-tested directly
// anywhere in tests/) they aren't callable here. This suite tests the
// *Core functions directly (service-role, no next/headers dependency) —
// the same boundary tests/money's webhook/purchase-flow suites use. Where
// a wrapper's RLS-gated table write matters (board settings / password /
// lock all write to modules.config via a plain RLS update), the
// underlying RLS policy is exercised directly via the signed-in client
// instead, and the wrapper's own config-merge logic is simulated with a
// direct service-role config write standing in for "the admin already
// set this."
describe("squares lifecycle", () => {
  let userA: Awaited<ReturnType<typeof signInTestUser>>;
  let userB: Awaited<ReturnType<typeof signInTestUser>>;
  let orgAId: string;
  let orgBId: string;
  let fundraiserAId: string;
  let moduleAId: string;
  const cleanupOrgIds: string[] = [];

  beforeAll(async () => {
    userA = await signInTestUser(10);
    userB = await signInTestUser(11);

    const suffix = randomUUID().slice(0, 8);
    const orgA = await createTestOrgWithFundraiser(userA, `sq-a-${suffix}`);
    const orgB = await createTestOrgWithFundraiser(userB, `sq-b-${suffix}`);
    orgAId = orgA.orgId;
    orgBId = orgB.orgId;
    fundraiserAId = orgA.fundraiserId;
    cleanupOrgIds.push(orgAId, orgBId);

    const admin = serviceClient();
    await admin.from("module_availability").insert({
      org_id: orgAId,
      module_type: "squares",
      enabled: true,
    });

    const { data: moduleRow, error: moduleError } = await userA.client
      .from("modules")
      .insert({ org_id: orgAId, fundraiser_id: fundraiserAId, type: "squares", status: "active" })
      .select("id")
      .single();
    if (moduleError) throw moduleError;
    moduleAId = moduleRow.id;
  });

  afterAll(async () => {
    // service_role bypasses RLS entirely (including the "no payment
    // activity" delete-block on fundraisers/organizations in
    // 0016_delete_policies.sql, which only applies to the `authenticated`
    // role) — safe to delete straight through even though this suite
    // creates real transactions rows via markSquarePaidCore.
    await serviceClient().from("organizations").delete().in("id", cleanupOrgIds);
  });

  async function setConfig(moduleId: string, config: SquaresConfig) {
    const { error } = await serviceClient().from("modules").update({ config }).eq("id", moduleId);
    if (error) throw error;
  }

  it("does not let org B update org A's module config (RLS)", async () => {
    const { error, data } = await userB.client
      .from("modules")
      .update({ config: { rowLabel: "Hijacked" } })
      .eq("id", moduleAId)
      .select("id");
    // RLS blocks the row from matching at all — no error, zero rows
    // affected, same shape as the existing product/module RLS tests.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("snapshots the configured price at claim time, unaffected by a later price change", async () => {
    await setConfig(moduleAId, { pricePerSquareCents: 1000 });

    await joinModuleCore({
      orgId: orgAId,
      moduleId: moduleAId,
      displayName: "Price Snapshot Test",
      position: 10,
    });

    // Price changes after the claim — the snapshot must not move.
    await setConfig(moduleAId, { pricePerSquareCents: 2500 });

    const { data: entry } = await serviceClient()
      .from("module_entries")
      .select("price_cents")
      .eq("module_id", moduleAId)
      .eq("position", 10)
      .single();
    expect(entry?.price_cents).toBe(1000);
  });

  it("runs the full paid -> void -> release -> reclaim lifecycle", async () => {
    await setConfig(moduleAId, { pricePerSquareCents: 500 });

    await joinModuleCore({
      orgId: orgAId,
      moduleId: moduleAId,
      displayName: "Lifecycle Test",
      position: 20,
    });
    const { data: claimed } = await serviceClient()
      .from("module_entries")
      .select("id, price_cents, transaction_id")
      .eq("module_id", moduleAId)
      .eq("position", 20)
      .single();
    expect(claimed?.price_cents).toBe(500);
    expect(claimed?.transaction_id).toBeNull();

    const { transactionId } = await markSquarePaidCore({
      orgId: orgAId,
      fundraiserId: fundraiserAId,
      moduleId: moduleAId,
      entryId: claimed!.id,
      method: "cash",
      enteredBy: userA.userId,
    });

    const { data: transaction } = await serviceClient()
      .from("transactions")
      .select("kind, gross_cents, module_id, status")
      .eq("id", transactionId)
      .single();
    expect(transaction?.kind).toBe("donation");
    expect(transaction?.gross_cents).toBe(500);
    expect(transaction?.module_id).toBe(moduleAId);
    expect(transaction?.status).toBe("succeeded");

    const { data: paidEntry } = await serviceClient()
      .from("module_entries")
      .select("transaction_id")
      .eq("id", claimed!.id)
      .single();
    expect(paidEntry?.transaction_id).toBe(transactionId);

    // Paid squares can't be released directly.
    await expect(
      releaseSquareCore({ orgId: orgAId, moduleId: moduleAId, entryId: claimed!.id, actor: userA.userId }),
    ).rejects.toThrow(/paid/i);

    await voidSquarePaymentCore({
      orgId: orgAId,
      moduleId: moduleAId,
      entryId: claimed!.id,
      enteredBy: userA.userId,
    });

    const { data: adjustment } = await serviceClient()
      .from("transactions")
      .select("kind, gross_cents")
      .eq("adjusts_transaction_id", transactionId)
      .single();
    expect(adjustment?.kind).toBe("adjustment");
    expect(adjustment?.gross_cents).toBe(-500);

    const { data: unpaidEntry } = await serviceClient()
      .from("module_entries")
      .select("transaction_id, position")
      .eq("id", claimed!.id)
      .single();
    expect(unpaidEntry?.transaction_id).toBeNull();

    await releaseSquareCore({ orgId: orgAId, moduleId: moduleAId, entryId: claimed!.id, actor: userA.userId });
    const { data: releasedEntry } = await serviceClient()
      .from("module_entries")
      .select("position")
      .eq("id", claimed!.id)
      .single();
    expect(releasedEntry?.position).toBeNull();

    // Position 20 is free again immediately.
    await joinModuleCore({
      orgId: orgAId,
      moduleId: moduleAId,
      displayName: "Reclaimer",
      position: 20,
    });
    const { data: reclaimed } = await serviceClient()
      .from("module_entries")
      .select("display_name")
      .eq("module_id", moduleAId)
      .eq("position", 20)
      .single();
    expect(reclaimed?.display_name).toBe("Reclaimer");
  });

  it("rejects a wrong or missing password, accepts the correct one", async () => {
    const password = "opensesame";
    await setConfig(moduleAId, {
      joinPasswordHash: createHash("sha256").update(password).digest("hex"),
    });

    await expect(
      joinModuleCore({
        orgId: orgAId,
        moduleId: moduleAId,
        displayName: "No Password",
        position: 30,
      }),
    ).rejects.toThrow(/password/i);

    await expect(
      joinModuleCore({
        orgId: orgAId,
        moduleId: moduleAId,
        displayName: "Wrong Password",
        position: 30,
        password: "nope",
      }),
    ).rejects.toThrow(/password/i);

    const { data: nothingClaimed } = await serviceClient()
      .from("module_entries")
      .select("id")
      .eq("module_id", moduleAId)
      .eq("position", 30);
    expect(nothingClaimed).toEqual([]);

    await joinModuleCore({
      orgId: orgAId,
      moduleId: moduleAId,
      displayName: "Correct Password",
      position: 30,
      password,
    });
    const { data: claimed } = await serviceClient()
      .from("module_entries")
      .select("id")
      .eq("module_id", moduleAId)
      .eq("position", 30)
      .maybeSingle();
    expect(claimed).not.toBeNull();

    await setConfig(moduleAId, {}); // clear password/price for later tests
  });

  it("rejects claims while the board is locked", async () => {
    await setConfig(moduleAId, { locked: true });

    await expect(
      joinModuleCore({
        orgId: orgAId,
        moduleId: moduleAId,
        displayName: "Should Fail",
        position: 40,
      }),
    ).rejects.toThrow(/locked/i);

    await setConfig(moduleAId, { locked: false });
  });

  it("draws the numbers exactly once per pool — they stay fixed for the whole game", async () => {
    const draw = await drawSquaresCore({ orgId: orgAId, moduleId: moduleAId, actor: userA.userId });
    expect([...draw.result.rowDigits].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([...draw.result.colDigits].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // A second draw is refused (pre-check) — periods never get their own numbers.
    await expect(
      drawSquaresCore({ orgId: orgAId, moduleId: moduleAId, actor: userA.userId }),
    ).rejects.toThrow(/already been drawn/i);

    // ...and the DB-level guarantee holds independently of the pre-check.
    const admin = serviceClient();
    const { error: dupError } = await admin.from("draws").insert({
      org_id: orgAId,
      module_id: moduleAId,
      segment: "final",
      algorithm: "test",
      inputs: {},
      result: { rowDigits: [], colDigits: [] },
      actor: userA.userId,
    });
    expect(dupError?.code).toBe("23505");

    const { data: allDraws } = await admin.from("draws").select("id").eq("module_id", moduleAId);
    expect(allDraws).toHaveLength(1);
  });

  it("lets an organizer assign squares by hand, ignoring the lock and password, and optionally mark them paid", async () => {
    const admin = serviceClient();
    await setConfig(moduleAId, {
      pricePerSquareCents: 2000,
      locked: true,
      joinPasswordHash: createHash("sha256").update("secret").digest("hex"),
    });

    // Guests are blocked by the lock...
    await expect(
      joinModuleCore({ orgId: orgAId, moduleId: moduleAId, displayName: "Guest", position: 70, password: "secret" }),
    ).rejects.toThrow(/locked/i);

    // ...the organizer isn't, and the price is snapshotted like any claim.
    const late = await assignSquareCore({
      orgId: orgAId,
      fundraiserId: fundraiserAId,
      moduleId: moduleAId,
      position: 70,
      displayName: "  Late Joiner  ",
      actor: userA.userId,
    });
    expect(late.paidError).toBeNull();
    const { data: lateRow } = await admin
      .from("module_entries")
      .select("display_name, position, price_cents, transaction_id")
      .eq("id", late.entryId)
      .single();
    expect(lateRow).toMatchObject({
      display_name: "Late Joiner",
      position: 70,
      price_cents: 2000,
      transaction_id: null,
    });

    // Assign + mark paid in one step writes a real offline-gift row tied to the module.
    const paid = await assignSquareCore({
      orgId: orgAId,
      fundraiserId: fundraiserAId,
      moduleId: moduleAId,
      position: 71,
      displayName: "Cash Payer",
      markPaid: true,
      method: "cash",
      actor: userA.userId,
    });
    expect(paid.paidError).toBeNull();
    const { data: paidRow } = await admin
      .from("module_entries")
      .select("transaction_id")
      .eq("id", paid.entryId)
      .single();
    expect(paidRow?.transaction_id).toBeTruthy();
    const { data: tx } = await admin
      .from("transactions")
      .select("kind, gross_cents, module_id")
      .eq("id", paidRow!.transaction_id)
      .single();
    expect(tx).toMatchObject({ kind: "donation", gross_cents: 2000, module_id: moduleAId });

    // A taken square, a bad square, and a blank name are all refused.
    await expect(
      assignSquareCore({ orgId: orgAId, fundraiserId: fundraiserAId, moduleId: moduleAId, position: 70, displayName: "Dup", actor: userA.userId }),
    ).rejects.toThrow(/already taken/i);
    await expect(
      assignSquareCore({ orgId: orgAId, fundraiserId: fundraiserAId, moduleId: moduleAId, position: 100, displayName: "X", actor: userA.userId }),
    ).rejects.toThrow(/between 1 and 100/i);
    await expect(
      assignSquareCore({ orgId: orgAId, fundraiserId: fundraiserAId, moduleId: moduleAId, position: 72, displayName: "   ", actor: userA.userId }),
    ).rejects.toThrow(/name/i);

    // Org isolation: an admin of org B can't assign into org A's pool, and
    // nothing is written when they try.
    await expect(
      assignSquareCore({ orgId: orgBId, fundraiserId: fundraiserAId, moduleId: moduleAId, position: 72, displayName: "Intruder", actor: userB.userId }),
    ).rejects.toThrow(/not found/i);
    const { data: leaked } = await admin
      .from("module_entries")
      .select("id")
      .eq("module_id", moduleAId)
      .eq("position", 72);
    expect(leaked).toHaveLength(0);

    // Both successful assignments are audited.
    const { data: audit } = await admin
      .from("audit_log")
      .select("after")
      .eq("action", "square.assigned_by_admin")
      .filter("after->>module_id", "eq", moduleAId);
    expect(audit?.map((a) => (a.after as { position: number }).position).sort()).toEqual([70, 71]);

    await setConfig(moduleAId, {}); // clear lock/password/price for later tests
  });

  it("releases only stale unpaid squares older than the cutoff", async () => {
    const admin = serviceClient();

    await joinModuleCore({ orgId: orgAId, moduleId: moduleAId, displayName: "Fresh Unpaid", position: 50 });
    await joinModuleCore({ orgId: orgAId, moduleId: moduleAId, displayName: "Stale Unpaid", position: 51 });

    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await admin
      .from("module_entries")
      .update({ created_at: staleDate })
      .eq("module_id", moduleAId)
      .eq("position", 51);

    await setConfig(moduleAId, { pricePerSquareCents: 500 });
    await joinModuleCore({ orgId: orgAId, moduleId: moduleAId, displayName: "Stale Paid", position: 52 });
    const { data: stalePaidEntry } = await admin
      .from("module_entries")
      .select("id")
      .eq("module_id", moduleAId)
      .eq("position", 52)
      .single();
    await markSquarePaidCore({
      orgId: orgAId,
      fundraiserId: fundraiserAId,
      moduleId: moduleAId,
      entryId: stalePaidEntry!.id,
      method: "cash",
      enteredBy: userA.userId,
    });
    await admin
      .from("module_entries")
      .update({ created_at: staleDate })
      .eq("id", stalePaidEntry!.id);

    const { releasedCount } = await releaseStaleSquaresCore({
      orgId: orgAId,
      moduleId: moduleAId,
      olderThanHours: 24,
      actor: userA.userId,
    });
    expect(releasedCount).toBe(1);

    const { data: positions } = await admin
      .from("module_entries")
      .select("position")
      .in("position", [50, 51, 52]);
    // Fresh unpaid (50) and stale-but-paid (52) survive; only stale unpaid
    // (51) was released.
    expect(new Set(positions?.map((p) => p.position))).toEqual(new Set([50, 52]));
  });

  it("does not let org B's markSquarePaidCore touch org A's entry (org-scoped data isolation)", async () => {
    await setConfig(moduleAId, { pricePerSquareCents: 500 });
    await joinModuleCore({ orgId: orgAId, moduleId: moduleAId, displayName: "Isolation Test", position: 60 });
    const { data: entry } = await serviceClient()
      .from("module_entries")
      .select("id")
      .eq("module_id", moduleAId)
      .eq("position", 60)
      .single();

    // Even with the service-role bypass, scoping every Core function's
    // fetch to the caller-supplied orgId is what stops org B's admin
    // wrapper (which validates admin-of-orgB before calling this) from
    // ever reaching org A's row — passing orgB's id here must fail the
    // same way a genuine cross-tenant attempt would.
    await expect(
      markSquarePaidCore({
        orgId: orgBId,
        fundraiserId: fundraiserAId,
        moduleId: moduleAId,
        entryId: entry!.id,
        method: "cash",
        enteredBy: userB.userId,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("logs claim/paid/void/release/sweep events to audit_log, queryable by module", async () => {
    const { data: rows, error } = await serviceClient()
      .from("audit_log")
      .select("action")
      .eq("org_id", orgAId)
      .filter("after->>module_id", "eq", moduleAId)
      .order("created_at", { ascending: true });
    expect(error).toBeNull();
    const actions = rows?.map((r) => r.action) ?? [];
    expect(actions).toContain("square.paid");
    expect(actions).toContain("square.payment_voided");
    expect(actions).toContain("square.released");
    expect(actions).toContain("squares.stale_swept");
  });

  // 0022_modules_delete_policy.sql — mirrors 0016_delete_policies.sql's
  // fundraiser/org shape for modules: closed + no transactions is
  // deletable, anything else silently matches 0 rows. Exercised via the
  // plain RLS-scoped client directly (deleteModuleCore itself lives in a
  // "use server" file and isn't callable here — see the suite-level scope
  // note), same as the "does not let org B update org A's module config"
  // test above.
  it("lets an org admin delete a closed module with no payment activity", async () => {
    const { data: deletable, error: createError } = await userA.client
      .from("modules")
      .insert({ org_id: orgAId, fundraiser_id: fundraiserAId, type: "squares", status: "draft" })
      .select("id")
      .single();
    if (createError) throw createError;

    await userA.client.from("modules").update({ status: "active" }).eq("id", deletable.id);
    await userA.client.from("modules").update({ status: "closed" }).eq("id", deletable.id);

    const { error, data } = await userA.client
      .from("modules")
      .delete()
      .eq("id", deletable.id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: deletable.id }]);
  });

  it("blocks deleting a closed module that has payment activity", async () => {
    const { data: paidModule, error: createError } = await userA.client
      .from("modules")
      .insert({ org_id: orgAId, fundraiser_id: fundraiserAId, type: "squares", status: "draft" })
      .select("id")
      .single();
    if (createError) throw createError;
    await userA.client.from("modules").update({ status: "active" }).eq("id", paidModule.id);

    await joinModuleCore({
      orgId: orgAId,
      moduleId: paidModule.id,
      displayName: "Has Activity",
      position: 0,
    });
    const { data: entry } = await serviceClient()
      .from("module_entries")
      .select("id")
      .eq("module_id", paidModule.id)
      .eq("position", 0)
      .single();
    await setConfig(paidModule.id, { pricePerSquareCents: 500 });
    await serviceClient().from("module_entries").update({ price_cents: 500 }).eq("id", entry!.id);
    await markSquarePaidCore({
      orgId: orgAId,
      fundraiserId: fundraiserAId,
      moduleId: paidModule.id,
      entryId: entry!.id,
      method: "cash",
      enteredBy: userA.userId,
    });

    await userA.client.from("modules").update({ status: "closed" }).eq("id", paidModule.id);

    const { error, data } = await userA.client
      .from("modules")
      .delete()
      .eq("id", paidModule.id)
      .select("id");
    // RLS blocks the row from matching at all — no error, zero rows.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: stillThere } = await serviceClient()
      .from("modules")
      .select("id")
      .eq("id", paidModule.id)
      .maybeSingle();
    expect(stillThere?.id).toBe(paidModule.id);
  });
});
