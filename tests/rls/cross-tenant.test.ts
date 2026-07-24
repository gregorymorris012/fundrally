import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient, signInTestUser } from "../helpers";

// Asserts the invariant from FundRally-Build-Spec.md section 9: a user who
// belongs to org A must not be able to read, write, or update org B's rows,
// on any table. Phase 0 only has `organizations` and `memberships`, so those
// are what's covered here — this file is the template every future table's
// RLS test should follow.
describe("cross-tenant RLS isolation", () => {
  let userA: Awaited<ReturnType<typeof signInTestUser>>;
  let userB: Awaited<ReturnType<typeof signInTestUser>>;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    userA = await signInTestUser(0);
    userB = await signInTestUser(1);

    const suffix = randomUUID().slice(0, 8);

    const { data: orgA, error: orgAError } = await userA.client.rpc(
      "create_organization",
      { p_name: "Org A", p_slug: `org-a-${suffix}`, p_state_code: "CA" },
    );
    if (orgAError) throw orgAError;
    orgAId = orgA as string;

    const { data: orgB, error: orgBError } = await userB.client.rpc(
      "create_organization",
      { p_name: "Org B", p_slug: `org-b-${suffix}`, p_state_code: "NY" },
    );
    if (orgBError) throw orgBError;
    orgBId = orgB as string;
  });

  afterAll(async () => {
    // service role bypasses RLS — used only for setup/teardown, never in
    // the assertions themselves.
    await serviceClient().from("organizations").delete().in("id", [orgAId, orgBId]);
  });

  it("lets a user read their own organization", async () => {
    const { data, error } = await userA.client
      .from("organizations")
      .select("id")
      .eq("id", orgAId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data?.id).toBe(orgAId);
  });

  it("hides org B from a user in org A", async () => {
    const { data, error } = await userA.client
      .from("organizations")
      .select("id")
      .eq("id", orgBId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("only lists organizations the user belongs to", async () => {
    const { data, error } = await userA.client.from("organizations").select("id");

    expect(error).toBeNull();
    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(orgAId);
    expect(ids).not.toContain(orgBId);
  });

  it("hides org B's membership rows from a user in org A", async () => {
    const { data, error } = await userA.client
      .from("memberships")
      .select("id, org_id")
      .eq("org_id", orgBId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("does not let a user rename org B", async () => {
    await userA.client.from("organizations").update({ name: "hijacked" }).eq("id", orgBId);

    const { data } = await serviceClient()
      .from("organizations")
      .select("name")
      .eq("id", orgBId)
      .single();
    expect(data?.name).toBe("Org B");
  });

  it("does not let a user delete org B", async () => {
    await userA.client.from("organizations").delete().eq("id", orgBId);

    const { data } = await serviceClient()
      .from("organizations")
      .select("id")
      .eq("id", orgBId)
      .maybeSingle();
    expect(data?.id).toBe(orgBId);
  });

  it("does not let a user add themselves to org B", async () => {
    const { error } = await userA.client.from("memberships").insert({
      org_id: orgBId,
      user_id: userA.userId,
      role: "owner",
    });
    expect(error).not.toBeNull();

    const { data } = await serviceClient()
      .from("memberships")
      .select("id")
      .eq("org_id", orgBId)
      .eq("user_id", userA.userId);
    expect(data).toEqual([]);
  });
});
