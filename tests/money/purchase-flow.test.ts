import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processStripeEvent } from "@/lib/payments/webhook-handlers";
import { createTestOrgWithFundraiser, serviceClient, signInTestUser } from "../helpers";
import { makeEvent } from "./fixtures";

// Phase 2's purchase path shares processStripeEvent() with Phase 1's
// donation path (tests/money/webhook-handlers.test.ts), but has extra
// side effects specific to orders — this covers those: the pending order
// created by createOrderIntent gets linked to its transaction and flipped
// to paid (or failed) by the webhook, never by the checkout request
// itself (rule 3).
describe("Stripe webhook processing — purchase orders", () => {
  const admin = serviceClient();
  let orgId: string;
  let fundraiserId: string;
  let moduleId: string;
  let productId: string;
  let participantId: string;
  const runId = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const owner = await signInTestUser(9);
    const org = await createTestOrgWithFundraiser(owner, `purchase-${runId}`);
    orgId = org.orgId;
    fundraiserId = org.fundraiserId;

    const { data: moduleRow, error: moduleError } = await admin
      .from("modules")
      .insert({ org_id: orgId, fundraiser_id: fundraiserId, type: "product", status: "active" })
      .select("id")
      .single();
    if (moduleError) throw moduleError;
    moduleId = moduleRow.id;

    const { data: productRow, error: productError } = await admin
      .from("products")
      .insert({ org_id: orgId, module_id: moduleId, name: "Cookie", price_cents: 500 })
      .select("id")
      .single();
    if (productError) throw productError;
    productId = productRow.id;

    const { data: participant, error: participantError } = await admin
      .from("participants")
      .insert({ org_id: orgId, display_name: "Guest", email: "guest@example.com" })
      .select("id")
      .single();
    if (participantError) throw participantError;
    participantId = participant.id;
  });

  afterAll(async () => {
    await admin.from("organizations").delete().eq("id", orgId);
  });

  async function createPendingOrder() {
    const { data: order, error } = await admin
      .from("orders")
      .insert({
        org_id: orgId,
        fundraiser_id: fundraiserId,
        module_id: moduleId,
        participant_id: participantId,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;

    await admin.from("order_items").insert({
      order_id: order.id,
      product_id: productId,
      quantity: 2,
      unit_price_cents: 500,
    });

    return order.id as string;
  }

  it("success: marks the order paid, links the transaction, and tags module_id on the ledger row", async () => {
    const orderId = await createPendingOrder();
    const paymentIntentId = `pi_purchase_${randomUUID().slice(0, 8)}`;

    await processStripeEvent(
      makeEvent(`evt_purchase_success_${randomUUID().slice(0, 8)}`, "payment_intent.succeeded", {
        id: paymentIntentId,
        amount: 1000,
        currency: "usd",
        application_fee_amount: 0,
        latest_charge: `ch_purchase_${randomUUID().slice(0, 8)}`,
        metadata: {
          org_id: orgId,
          fundraiser_id: fundraiserId,
          participant_id: participantId,
          module_id: moduleId,
          order_id: orderId,
          kind: "purchase",
        },
      }),
      admin,
    );

    const { data: order } = await admin
      .from("orders")
      .select("status, transaction_id")
      .eq("id", orderId)
      .single();
    expect(order?.status).toBe("paid");
    expect(order?.transaction_id).toBeTruthy();

    const { data: transaction } = await admin
      .from("transactions")
      .select("kind, module_id, gross_cents")
      .eq("id", order!.transaction_id!)
      .single();
    expect(transaction?.kind).toBe("purchase");
    expect(transaction?.module_id).toBe(moduleId);
    expect(transaction?.gross_cents).toBe(1000);
  });

  it("failure: marks the order failed and writes no ledger row", async () => {
    const orderId = await createPendingOrder();
    const paymentIntentId = `pi_purchase_failed_${randomUUID().slice(0, 8)}`;

    await processStripeEvent(
      makeEvent(`evt_purchase_failed_${randomUUID().slice(0, 8)}`, "payment_intent.payment_failed", {
        id: paymentIntentId,
        metadata: { org_id: orgId, kind: "purchase", order_id: orderId },
        last_payment_error: { message: "card declined" },
      }),
      admin,
    );

    const { data: order } = await admin
      .from("orders")
      .select("status, transaction_id")
      .eq("id", orderId)
      .single();
    expect(order?.status).toBe("failed");
    expect(order?.transaction_id).toBeNull();

    const { data: transactions } = await admin
      .from("transactions")
      .select("id")
      .eq("stripe_payment_intent_id", paymentIntentId);
    expect(transactions).toEqual([]);
  });
});
