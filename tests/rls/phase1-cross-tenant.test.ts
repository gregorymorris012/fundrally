import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  createTestOrgWithFundraiser,
  serviceClient,
  signInTestUser,
} from "../helpers";

// Covers the Phase 1 tables (fundraisers, participants, transactions,
// audit_log) with the same invariant as tests/rls/cross-tenant.test.ts: a
// user in org A must not read, write, or update org B's rows. Also
// verifies the one deliberate exception — anon can read an *active*
// fundraiser and its org's public fields, because the donate page has to
// work for signed-out guests (db/migrations/0005_public_donate_policies.sql).
describe("Phase 1 cross-tenant RLS isolation", () => {
  let userA: Awaited<ReturnType<typeof signInTestUser>>;
  let userB: Awaited<ReturnType<typeof signInTestUser>>;
  let volunteer: Awaited<ReturnType<typeof signInTestUser>>;
  let orgAId: string;
  let orgBId: string;
  let fundraiserAId: string;
  let participantAId: string;
  let transactionAId: string;

  beforeAll(async () => {
    userA = await signInTestUser(2);
    userB = await signInTestUser(3);
    volunteer = await signInTestUser(4);

    const suffix = randomUUID().slice(0, 8);
    const orgA = await createTestOrgWithFundraiser(userA, `a-${suffix}`);
    const orgB = await createTestOrgWithFundraiser(userB, `b-${suffix}`);
    orgAId = orgA.orgId;
    orgBId = orgB.orgId;
    fundraiserAId = orgA.fundraiserId;

    const admin = serviceClient();

    await admin.from("memberships").insert({
      org_id: orgAId,
      user_id: volunteer.userId,
      role: "volunteer",
    });

    const { data: participant } = await admin
      .from("participants")
      .insert({ org_id: orgAId, display_name: "Guest", email: "guest@example.com" })
      .select("id")
      .single();
    participantAId = participant!.id;

    const { data: transaction } = await admin
      .from("transactions")
      .insert({
        org_id: orgAId,
        fundraiser_id: fundraiserAId,
        participant_id: participantAId,
        kind: "donation",
        gross_cents: 2500,
        fee_cents: 0,
        net_cents: 2500,
        currency: "usd",
        status: "succeeded",
      })
      .select("id")
      .single();
    transactionAId = transaction!.id;

    await admin.from("audit_log").insert({
      org_id: orgAId,
      actor: "test-setup",
      action: "test.seed",
      after: { transaction_id: transactionAId },
    });
  });

  afterAll(async () => {
    await serviceClient().from("organizations").delete().in("id", [orgAId, orgBId]);
  });

  it("hides org A's fundraiser from a user in org B", async () => {
    const { data, error } = await userB.client
      .from("fundraisers")
      .select("id")
      .eq("id", fundraiserAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("does not let a user in org B create a fundraiser in org A", async () => {
    const { error } = await userB.client.from("fundraisers").insert({
      org_id: orgAId,
      title: "Hijack",
      slug: "hijack",
    });
    expect(error).not.toBeNull();
  });

  it("does not let a volunteer create a fundraiser in their own org", async () => {
    const { error } = await volunteer.client.from("fundraisers").insert({
      org_id: orgAId,
      title: "Volunteer attempt",
      slug: "volunteer-attempt",
    });
    expect(error).not.toBeNull();
  });

  it("lets an org admin create a fundraiser in their own org", async () => {
    const { error } = await userA.client.from("fundraisers").insert({
      org_id: orgAId,
      title: "Second fundraiser",
      slug: "second",
    });
    expect(error).toBeNull();
  });

  it("hides org A's participants from a user in org B", async () => {
    const { data, error } = await userB.client
      .from("participants")
      .select("id")
      .eq("org_id", orgAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("hides org A's transactions from a user in org B", async () => {
    const { data, error } = await userB.client
      .from("transactions")
      .select("id")
      .eq("org_id", orgAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("does not let a user in org B update org A's transaction", async () => {
    await userB.client
      .from("transactions")
      .update({ status: "refunded" })
      .eq("id", transactionAId);

    const { data } = await serviceClient()
      .from("transactions")
      .select("status")
      .eq("id", transactionAId)
      .single();
    expect(data?.status).toBe("succeeded");
  });

  it("hides org A's audit log from a user in org B", async () => {
    const { data, error } = await userB.client
      .from("audit_log")
      .select("id")
      .eq("org_id", orgAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("lets a signed-out guest read the active fundraiser (intentional)", async () => {
    const { data, error } = await anonClient()
      .from("fundraisers")
      .select("title, organizations(name, charges_enabled)")
      .eq("id", fundraiserAId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.title).toBeTruthy();
  });

  it("does not let a signed-out guest read participants or transactions", async () => {
    const guest = anonClient();
    const participants = await guest
      .from("participants")
      .select("id")
      .eq("org_id", orgAId);
    const transactions = await guest
      .from("transactions")
      .select("id")
      .eq("org_id", orgAId);

    expect(participants.error).not.toBeNull();
    expect(transactions.error).not.toBeNull();
  });
});
