import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  createTestOrgWithFundraiser,
  serviceClient,
  signInTestUser,
} from "../helpers";

// Covers the Phase 2 tables (modules, products, orders, order_items) with
// the same cross-tenant invariant as the other RLS suites, plus the
// intentional anon-read exception for the public shop page — mirrors
// tests/rls/phase1-cross-tenant.test.ts.
describe("Phase 2 cross-tenant RLS isolation", () => {
  let userA: Awaited<ReturnType<typeof signInTestUser>>;
  let userB: Awaited<ReturnType<typeof signInTestUser>>;
  let volunteer: Awaited<ReturnType<typeof signInTestUser>>;
  let orgAId: string;
  let orgBId: string;
  let fundraiserAId: string;
  let moduleAId: string;
  let productAId: string;
  let orderAId: string;

  beforeAll(async () => {
    userA = await signInTestUser(5);
    userB = await signInTestUser(6);
    volunteer = await signInTestUser(7);

    const suffix = randomUUID().slice(0, 8);
    const orgA = await createTestOrgWithFundraiser(userA, `p2a-${suffix}`);
    const orgB = await createTestOrgWithFundraiser(userB, `p2b-${suffix}`);
    orgAId = orgA.orgId;
    orgBId = orgB.orgId;
    fundraiserAId = orgA.fundraiserId;

    await serviceClient().from("memberships").insert({
      org_id: orgAId,
      user_id: volunteer.userId,
      role: "volunteer",
    });

    const { data: moduleRow, error: moduleError } = await userA.client
      .from("modules")
      .insert({ org_id: orgAId, fundraiser_id: orgA.fundraiserId, type: "product", status: "active" })
      .select("id")
      .single();
    if (moduleError) throw moduleError;
    moduleAId = moduleRow.id;

    const { data: productRow, error: productError } = await userA.client
      .from("products")
      .insert({ org_id: orgAId, module_id: moduleAId, name: "Cookie", price_cents: 500 })
      .select("id")
      .single();
    if (productError) throw productError;
    productAId = productRow.id;

    const admin = serviceClient();
    const { data: participant } = await admin
      .from("participants")
      .insert({ org_id: orgAId, display_name: "Guest", email: "guest@example.com" })
      .select("id")
      .single();

    const { data: order } = await admin
      .from("orders")
      .insert({
        org_id: orgAId,
        fundraiser_id: orgA.fundraiserId,
        module_id: moduleAId,
        participant_id: participant!.id,
        status: "pending",
      })
      .select("id")
      .single();
    orderAId = order!.id;

    await admin.from("order_items").insert({
      order_id: orderAId,
      product_id: productAId,
      quantity: 2,
      unit_price_cents: 500,
    });
  });

  afterAll(async () => {
    await serviceClient().from("organizations").delete().in("id", [orgAId, orgBId]);
  });

  it("hides org A's module from a user in org B", async () => {
    const { data, error } = await userB.client.from("modules").select("id").eq("id", moduleAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("does not let a user in org B create a module in org A", async () => {
    const { error } = await userB.client.from("modules").insert({
      org_id: orgAId,
      fundraiser_id: fundraiserAId,
      type: "product",
    });
    expect(error).not.toBeNull();
  });

  it("does not let a volunteer create a product in their own org", async () => {
    const { error } = await volunteer.client.from("products").insert({
      org_id: orgAId,
      module_id: moduleAId,
      name: "Hijack",
      price_cents: 100,
    });
    expect(error).not.toBeNull();
  });

  it("hides org A's products from a user in org B", async () => {
    const { data, error } = await userB.client.from("products").select("id").eq("id", productAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("hides org A's orders and order items from a user in org B", async () => {
    const orders = await userB.client.from("orders").select("id").eq("id", orderAId);
    const items = await userB.client.from("order_items").select("id").eq("order_id", orderAId);
    expect(orders.error).toBeNull();
    expect(orders.data).toEqual([]);
    expect(items.error).toBeNull();
    expect(items.data).toEqual([]);
  });

  it("lets a signed-out guest read the active product module and its products (intentional)", async () => {
    const guest = anonClient();
    const moduleResult = await guest.from("modules").select("id").eq("id", moduleAId).maybeSingle();
    const productResult = await guest
      .from("products")
      .select("id, name, price_cents")
      .eq("id", productAId)
      .maybeSingle();

    expect(moduleResult.error).toBeNull();
    expect(moduleResult.data?.id).toBe(moduleAId);
    expect(productResult.error).toBeNull();
    expect(productResult.data?.name).toBe("Cookie");
  });

  it("does not let a signed-out guest read orders or order items", async () => {
    const guest = anonClient();
    const orders = await guest.from("orders").select("id").eq("id", orderAId);
    const items = await guest.from("order_items").select("id").eq("order_id", orderAId);
    expect(orders.error).not.toBeNull();
    expect(items.error).not.toBeNull();
  });
});
