import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

// Deliberately no `import "server-only"` here: this module is exercised
// directly by tests/money/webhook-handlers.test.ts under plain Node/Vitest,
// where the package's marker throws unconditionally (it only resolves to a
// no-op under Next.js's own "react-server" bundler condition). It's safe to
// omit — this file is only ever reached via a Route Handler or tests,
// never a client bundle, both of which are already server-only by
// construction.

// Everything money-relevant lands here, not in the route handler, so tests
// can call it directly against a real local database with a fabricated
// Stripe event — no live Stripe API calls or running Next.js server
// required. See tests/money/webhook-handlers.test.ts.
//
// Rule 3 (build spec): webhooks are the source of truth for money. This
// file is the ONLY place `transactions` rows get written for payments.
export async function processStripeEvent(
  event: Stripe.Event,
  admin: SupabaseClient,
): Promise<void> {
  // Idempotent by event id (build spec section 5): a redelivered event is
  // a no-op. `ignoreDuplicates` means a duplicate insert returns no rows
  // rather than erroring, which is how we detect "already handled".
  const { data: inserted, error: insertError } = await admin
    .from("stripe_webhook_events")
    .upsert(
      { id: event.id, type: event.type, payload: event as unknown as object },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id");
  if (insertError) throw insertError;
  if (!inserted || inserted.length === 0) return;

  switch (event.type) {
    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(event, admin);
      break;
    case "payment_intent.payment_failed":
      await handlePaymentIntentFailed(event, admin);
      break;
    case "charge.refunded":
      await handleChargeRefunded(event, admin);
      break;
    case "charge.dispute.created":
      await handleDisputeCreated(event, admin);
      break;
    case "account.updated":
      await handleAccountUpdated(event, admin);
      break;
    case "payout.created":
    case "payout.updated":
    case "payout.paid":
    case "payout.failed":
    case "payout.canceled":
      await handlePayoutEvent(event, admin);
      break;
    default:
      break;
  }

  await admin
    .from("stripe_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", event.id);
}

async function handlePaymentIntentSucceeded(
  event: Stripe.Event,
  admin: SupabaseClient,
) {
  const pi = event.data.object as Stripe.PaymentIntent;
  const orgId = pi.metadata.org_id;
  const fundraiserId = pi.metadata.fundraiser_id;
  const participantId = pi.metadata.participant_id;
  const moduleId = pi.metadata.module_id || null;
  const orderId = pi.metadata.order_id || null;
  const kind = (pi.metadata.kind || "donation") as
    | "purchase"
    | "bid_win"
    | "donation"
    | "refund"
    | "fee";
  if (!orgId || !fundraiserId || !participantId) return;

  const grossCents = pi.amount;
  const feeCents = pi.application_fee_amount ?? 0;

  const { data: transaction, error: transactionError } = await admin
    .from("transactions")
    .insert({
      org_id: orgId,
      fundraiser_id: fundraiserId,
      module_id: moduleId,
      participant_id: participantId,
      kind,
      gross_cents: grossCents,
      fee_cents: feeCents,
      net_cents: grossCents - feeCents,
      currency: pi.currency,
      stripe_payment_intent_id: pi.id,
      stripe_charge_id:
        typeof pi.latest_charge === "string" ? pi.latest_charge : null,
      status: "succeeded",
    })
    .select()
    .single();
  if (transactionError) throw transactionError;

  // Phase 2: a `purchase` PaymentIntent created via createOrderIntent
  // carries the pending order's id in metadata — flip it to paid and link
  // the transaction now that the webhook (the source of truth, rule 3)
  // confirms the charge actually succeeded.
  if (kind === "purchase" && orderId) {
    await admin
      .from("orders")
      .update({ status: "paid", transaction_id: transaction?.id ?? null })
      .eq("id", orderId);
  }

  await admin.from("audit_log").insert({
    org_id: orgId,
    actor: "stripe_webhook",
    action: "payment_intent.succeeded",
    after: transaction ?? { stripe_payment_intent_id: pi.id },
  });
}

async function handlePaymentIntentFailed(
  event: Stripe.Event,
  admin: SupabaseClient,
) {
  const pi = event.data.object as Stripe.PaymentIntent;
  const orgId = pi.metadata.org_id;
  if (!orgId) return;

  const orderId = pi.metadata.order_id || null;
  if (pi.metadata.kind === "purchase" && orderId) {
    await admin.from("orders").update({ status: "failed" }).eq("id", orderId);
  }

  // No ledger row — the ledger reflects money that actually moved. A
  // failed attempt is recorded for visibility only.
  await admin.from("audit_log").insert({
    org_id: orgId,
    actor: "stripe_webhook",
    action: "payment_intent.payment_failed",
    after: {
      stripe_payment_intent_id: pi.id,
      last_payment_error: pi.last_payment_error?.message ?? null,
    },
  });
}

async function handleChargeRefunded(event: Stripe.Event, admin: SupabaseClient) {
  const charge = event.data.object as Stripe.Charge;

  const { data: original } = await admin
    .from("transactions")
    .select("org_id, fundraiser_id, participant_id, stripe_payment_intent_id")
    .eq("stripe_charge_id", charge.id)
    .eq("kind", "donation")
    .maybeSingle();
  if (!original) return;

  const { data: priorRefunds } = await admin
    .from("transactions")
    .select("net_cents")
    .eq("stripe_charge_id", charge.id)
    .eq("kind", "refund");
  const alreadyRefundedCents = (priorRefunds ?? []).reduce(
    (sum, row) => sum + Math.abs(row.net_cents as number),
    0,
  );
  const refundDeltaCents = charge.amount_refunded - alreadyRefundedCents;
  if (refundDeltaCents <= 0) return;

  const { data: transaction } = await admin
    .from("transactions")
    .insert({
      org_id: original.org_id,
      fundraiser_id: original.fundraiser_id,
      participant_id: original.participant_id,
      kind: "refund",
      gross_cents: -refundDeltaCents,
      // Refunds here never carry `refund_application_fee: true` (see the
      // refund server action), so the platform fee stays with the
      // platform — the refund's own fee/net are the same negative amount.
      fee_cents: 0,
      net_cents: -refundDeltaCents,
      currency: charge.currency,
      stripe_payment_intent_id: original.stripe_payment_intent_id,
      stripe_charge_id: charge.id,
      status: "succeeded",
    })
    .select()
    .single();

  await admin.from("audit_log").insert({
    org_id: original.org_id,
    actor: "stripe_webhook",
    action: "charge.refunded",
    before: { amount_refunded_cents: alreadyRefundedCents },
    after: transaction ?? { amount_refunded_cents: charge.amount_refunded },
  });
}

async function handleDisputeCreated(event: Stripe.Event, admin: SupabaseClient) {
  const dispute = event.data.object as Stripe.Dispute;
  const chargeId =
    typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;

  const { data: original } = await admin
    .from("transactions")
    .select("org_id")
    .eq("stripe_charge_id", chargeId)
    .eq("kind", "donation")
    .maybeSingle();
  if (!original) return;

  // No ledger row yet — Phase 1 doesn't model dispute fund holds/losses.
  // This is here so the event is at least visible in the audit trail.
  await admin.from("audit_log").insert({
    org_id: original.org_id,
    actor: "stripe_webhook",
    action: "charge.dispute.created",
    after: {
      dispute_id: dispute.id,
      amount_cents: dispute.amount,
      reason: dispute.reason,
    },
  });
}

async function handleAccountUpdated(event: Stripe.Event, admin: SupabaseClient) {
  const account = event.data.object as Stripe.Account;

  const { data: org } = await admin
    .from("organizations")
    .select("id, charges_enabled, payouts_enabled")
    .eq("stripe_account_id", account.id)
    .maybeSingle();
  if (!org) return;

  const before = {
    charges_enabled: org.charges_enabled,
    payouts_enabled: org.payouts_enabled,
  };
  const after = {
    charges_enabled: account.charges_enabled ?? false,
    payouts_enabled: account.payouts_enabled ?? false,
  };

  await admin.from("organizations").update(after).eq("id", org.id);

  await admin.from("audit_log").insert({
    org_id: org.id,
    actor: "stripe_webhook",
    action: "account.updated",
    before,
    after,
  });
}

// Phase 3 (build spec section 8: "Reporting + payouts") — a read-only
// mirror of Stripe's own payout objects, not a ledger FundRally writes to
// (see db/schema/payouts.ts). One handler for all payout.* event types
// rather than one per type, because Stripe delivers the payout's current
// state on every one of them regardless of which type fired — reading
// payout.status directly is simpler and more robust than trying to infer
// a target status from event.type. `event.account` (not
// event.data.object.id, which is the payout's own id) is the connected
// account a Connect-scoped event is about — same field
// handleAccountUpdated would use if account.updated events carried it
// separately from the account object itself.
async function handlePayoutEvent(event: Stripe.Event, admin: SupabaseClient) {
  const payout = event.data.object as Stripe.Payout;
  const stripeAccountId = event.account;
  if (!stripeAccountId) return;

  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("stripe_account_id", stripeAccountId)
    .maybeSingle();
  if (!org) return;

  const { data: existing } = await admin
    .from("payouts")
    .select("status")
    .eq("stripe_payout_id", payout.id)
    .maybeSingle();

  const after = {
    org_id: org.id,
    stripe_payout_id: payout.id,
    amount_cents: payout.amount,
    currency: payout.currency,
    status: payout.status,
    arrival_date: new Date(payout.arrival_date * 1000).toISOString(),
    failure_code: payout.failure_code,
    failure_message: payout.failure_message,
  };

  const { error } = await admin
    .from("payouts")
    .upsert(after, { onConflict: "stripe_payout_id" });
  if (error) throw error;

  await admin.from("audit_log").insert({
    org_id: org.id,
    actor: "stripe_webhook",
    action: event.type,
    before: existing ? { status: existing.status } : null,
    after: { status: after.status, amount_cents: after.amount_cents },
  });
}
