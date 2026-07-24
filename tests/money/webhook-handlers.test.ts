import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { processStripeEvent } from "@/lib/payments/webhook-handlers";
import { createTestOrgWithFundraiser, serviceClient, signInTestUser } from "../helpers";
import { makeEvent } from "./fixtures";

// Build spec section 9: "every transaction path has a test covering
// success, failure, retry, refund, and dispute." These call
// processStripeEvent() directly against the real local database with
// fabricated Stripe events — no live Stripe API and no running Next.js
// server needed, since all the logic under test is what OUR code does
// once an event arrives, not Stripe's delivery mechanism.
describe("Stripe webhook processing", () => {
  const admin = serviceClient();
  let orgId: string;
  let fundraiserId: string;
  let participantId: string;
  // stripe_webhook_events persists across test runs (no auto-reset), and
  // processStripeEvent is idempotent by event id by design — so fixed
  // literal event ids would only ever process once, ever. Every id here
  // must be unique per run, same reasoning as the org slug below.
  const runId = randomUUID().slice(0, 8);
  const paymentIntentId = `pi_test_${runId}`;
  const chargeId = `ch_test_${runId}`;

  beforeAll(async () => {
    const owner = await signInTestUser(8);
    const org = await createTestOrgWithFundraiser(owner, `money-${randomUUID().slice(0, 8)}`);
    orgId = org.orgId;
    fundraiserId = org.fundraiserId;

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

  it("success: payment_intent.succeeded writes a transactions row and an audit row", async () => {
    await processStripeEvent(
      makeEvent(`evt_success_${runId}`, "payment_intent.succeeded", {
        id: paymentIntentId,
        amount: 2500,
        currency: "usd",
        application_fee_amount: 0,
        latest_charge: chargeId,
        metadata: {
          org_id: orgId,
          fundraiser_id: fundraiserId,
          participant_id: participantId,
          kind: "donation",
        },
      }),
      admin,
    );

    const { data: transaction } = await admin
      .from("transactions")
      .select("*")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .single();
    expect(transaction?.gross_cents).toBe(2500);
    expect(transaction?.fee_cents).toBe(0);
    expect(transaction?.net_cents).toBe(2500);
    expect(transaction?.status).toBe("succeeded");
    expect(transaction?.kind).toBe("donation");

    const { data: audit } = await admin
      .from("audit_log")
      .select("*")
      .eq("org_id", orgId)
      .eq("action", "payment_intent.succeeded");
    expect(audit).toHaveLength(1);
  });

  it("retry: redelivering the same event id does not double-write the ledger", async () => {
    await processStripeEvent(
      makeEvent(`evt_success_${runId}`, "payment_intent.succeeded", {
        id: paymentIntentId,
        amount: 2500,
        currency: "usd",
        application_fee_amount: 0,
        latest_charge: chargeId,
        metadata: {
          org_id: orgId,
          fundraiser_id: fundraiserId,
          participant_id: participantId,
          kind: "donation",
        },
      }),
      admin,
    );

    const { data: transactions } = await admin
      .from("transactions")
      .select("id")
      .eq("stripe_payment_intent_id", paymentIntentId);
    expect(transactions).toHaveLength(1);
  });

  it("failure: payment_intent.payment_failed writes no ledger row, only an audit row", async () => {
    const failedPaymentIntentId = `pi_failed_${randomUUID().slice(0, 8)}`;

    await processStripeEvent(
      makeEvent(`evt_failed_${runId}`, "payment_intent.payment_failed", {
        id: failedPaymentIntentId,
        metadata: { org_id: orgId },
        last_payment_error: { message: "card declined" },
      }),
      admin,
    );

    const { data: transactions } = await admin
      .from("transactions")
      .select("id")
      .eq("stripe_payment_intent_id", failedPaymentIntentId);
    expect(transactions).toEqual([]);

    const { data: audit } = await admin
      .from("audit_log")
      .select("after")
      .eq("org_id", orgId)
      .eq("action", "payment_intent.payment_failed")
      .single();
    expect((audit?.after as { last_payment_error: string })?.last_payment_error).toBe(
      "card declined",
    );
  });

  it("refund: charge.refunded writes a negative row and never edits the original", async () => {
    await processStripeEvent(
      makeEvent(`evt_refund_${runId}`, "charge.refunded", {
        id: chargeId,
        amount_refunded: 2500,
        currency: "usd",
        payment_intent: paymentIntentId,
      }),
      admin,
    );

    const { data: refundRow } = await admin
      .from("transactions")
      .select("*")
      .eq("stripe_charge_id", chargeId)
      .eq("kind", "refund")
      .single();
    expect(refundRow?.gross_cents).toBe(-2500);
    expect(refundRow?.net_cents).toBe(-2500);

    const { data: originalRow } = await admin
      .from("transactions")
      .select("gross_cents, status")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .eq("kind", "donation")
      .single();
    expect(originalRow?.gross_cents).toBe(2500);
    expect(originalRow?.status).toBe("succeeded");
  });

  it("dispute: charge.dispute.created writes only an audit row, no ledger row", async () => {
    const { count: transactionsBefore } = await admin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);

    await processStripeEvent(
      makeEvent(`evt_dispute_${runId}`, "charge.dispute.created", {
        id: `dp_test_${runId}`,
        charge: chargeId,
        amount: 2500,
        reason: "fraudulent",
      }),
      admin,
    );

    const { count: transactionsAfter } = await admin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);
    expect(transactionsAfter).toBe(transactionsBefore);

    const { data: audit } = await admin
      .from("audit_log")
      .select("id")
      .eq("org_id", orgId)
      .eq("action", "charge.dispute.created");
    expect(audit).toHaveLength(1);
  });

  it("account.updated flips charges_enabled/payouts_enabled and logs before/after", async () => {
    const stripeAccountId = `acct_test_${randomUUID().slice(0, 8)}`;
    await admin.from("organizations").update({ stripe_account_id: stripeAccountId }).eq(
      "id",
      orgId,
    );

    await processStripeEvent(
      makeEvent(`evt_account_${runId}`, "account.updated", {
        id: stripeAccountId,
        charges_enabled: true,
        payouts_enabled: true,
      }),
      admin,
    );

    const { data: org } = await admin
      .from("organizations")
      .select("charges_enabled, payouts_enabled")
      .eq("id", orgId)
      .single();
    expect(org?.charges_enabled).toBe(true);
    expect(org?.payouts_enabled).toBe(true);

    const { data: audit } = await admin
      .from("audit_log")
      .select("before, after")
      .eq("org_id", orgId)
      .eq("action", "account.updated")
      .single();
    expect((audit?.before as { charges_enabled: boolean })?.charges_enabled).toBe(false);
    expect((audit?.after as { charges_enabled: boolean })?.charges_enabled).toBe(true);
  });
});
