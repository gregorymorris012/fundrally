import "server-only";
import Stripe from "stripe";

// Lazy on purpose: Next.js evaluates route/action modules while collecting
// page data at build time, before Vercel injects runtime env vars into a
// freshly-linked project — an eager `new Stripe(...)` at module scope
// fails the build with "Neither apiKey nor config.authenticator provided".
// Constructing on first actual use defers that to request time instead.
let stripeClient: Stripe | undefined;

export function getStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return stripeClient;
}
