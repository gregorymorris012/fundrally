import type Stripe from "stripe";

// Builds just enough of a Stripe.Event shape to exercise our own handler
// logic in src/lib/payments/webhook-handlers.ts — these tests are about
// what OUR code does with an event, not Stripe's SDK, so there's no need
// for (and no live API call to get) a fully spec-compliant event object.
export function makeEvent(id: string, type: string, object: unknown): Stripe.Event {
  return {
    id,
    object: "event",
    api_version: "2025-01-01",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  } as unknown as Stripe.Event;
}
