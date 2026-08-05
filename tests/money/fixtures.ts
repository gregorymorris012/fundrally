import type Stripe from "stripe";

// Builds just enough of a Stripe.Event shape to exercise our own handler
// logic in src/lib/payments/webhook-handlers.ts — these tests are about
// what OUR code does with an event, not Stripe's SDK, so there's no need
// for (and no live API call to get) a fully spec-compliant event object.
// `account` is only present on Connect-scoped events (the connected
// account an event is *about* — payout.*, account.updated, etc.) and
// absent on platform-level events, so it's an optional 4th param rather
// than something every call site has to pass.
export function makeEvent(
  id: string,
  type: string,
  object: unknown,
  account?: string,
): Stripe.Event {
  return {
    id,
    object: "event",
    account,
    api_version: "2025-01-01",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  } as unknown as Stripe.Event;
}
