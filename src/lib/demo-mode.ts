// Active deviation (CLAUDE.md "Current deviations from the build spec"):
// Stripe connection is not a hard gate on fundraiser/module creation or
// launch at this stage. In practice, creation/launch were never actually
// gated on Stripe (see db/migrations/0004_phase1_policies.sql /
// 0007_phase2_policies.sql — plain admin-only RLS, no Stripe check) — the
// real hard requirement lives in src/lib/payments/create-donation-intent.ts
// and create-order-intent.ts, which correctly refuse to create a real
// Stripe PaymentIntent without a connected, charges-enabled account (that
// can't be "flagged around" — there's no card processor to talk to
// without it). So this flag's actual job is narrower than the name
// suggests: it softens the org dashboard's "connect Stripe" messaging so a
// demo org isn't stuck staring at a blocking-looking warning, while the
// real checkout gate stays exactly as strict as it already was.
//
// Same env-flag shape as TEST_LOGIN_ENABLED in src/lib/auth.ts — on by
// default outside production, opt-in on production/shared deployments via
// NEXT_PUBLIC_DEMO_MODE.
export const DEMO_MODE_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_DEMO_MODE === "true";

// Fixed (not random-per-click, unlike testLoginAction) on purpose: the
// stakeholder walkthrough needs everyone who clicks "View demo" to land on
// the *same* pre-seeded NuPath 2026 fundraiser every time, not their own
// blank-slate org. This is a deliberately different, parallel login path
// from Test Login, not a change to it — Test Login still gives every
// clicker an isolated fresh org (see src/lib/auth.ts), which is exactly
// what it's for and shouldn't be touched.
export const DEMO_OWNER_EMAIL = "demo-owner@fundrally.test";
export const DEMO_ORG_SLUG = "nupath-2026-demo";
export const DEMO_FUNDRAISER_SLUG = "nupath-2026";
