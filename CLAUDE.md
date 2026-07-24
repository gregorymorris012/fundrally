# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

FundRally: a multi-tenant platform where nonprofit organizers run community
fundraisers (auctions, raffles, 50/50, prize wheels, squares, golf outings,
product sales) and guests pay from their phones. The full product spec —
data model, payments flow, realtime channels, build phases, non-negotiable
rules — lives in `FundRally-Build-Spec.md` at the repo root. **Read it before
making any architectural decision; this file only covers what's actually
built and how to work in this repo day to day.**

Two constraints from the spec shape everything: the platform never holds
charitable funds or touches card data (Stripe Connect direct charges only),
and every fundraiser format must be independently enable-able per tenant
(gaming law varies by state — see `module_availability` in the spec).

Currently implemented: **Phase 0 (auth, `organizations`, `memberships`,
RLS), Phase 1 (Stripe Connect onboarding, PaymentIntents, webhook handler,
`transactions` ledger, refunds), and Phase 2 (the `product` module — shop
catalog, cart, checkout, admin order history)**. `product` is the only
`modules.type` with any code behind it — auction/wheel/squares/fifty_fifty/
golf/item_raffle are Phase 5/6/7 and don't exist yet beyond the enum value.
Don't assume later-phase tables (`draws`, `module_availability`,
`compliance_records`, etc.) exist; check `db/schema/` before referencing
them. In particular, don't build UI for the chance-based module types
(wheel, squares, fifty_fifty, item_raffle) before Phase 4's compliance
gating exists — the build spec is explicit that they can't ship without it.

## Commands

```bash
npm run dev              # Next.js dev server
npm run build             # production build
npm run lint               # eslint
npx tsc --noEmit           # typecheck

npm run supabase:start     # spin up local Supabase (needs Docker running)
npm run supabase:stop
npm run supabase:reset     # drop + re-apply all migrations + seed

npm run db:generate        # drizzle-kit generate — diff db/schema/*.ts into a new migration
npm run db:migrate         # drizzle-kit migrate — apply db/migrations/*.sql
npm run db:studio          # drizzle-kit studio

npm test                   # vitest run (all tests)
npm run test:rls           # vitest run tests/rls — the mandatory cross-tenant suite
npm run test:money         # vitest run tests/money — webhook processing paths
```

Local dev setup: `supabase start`, then copy the printed `API URL`, `anon
key`, and `service_role key` into `.env.local` (see `.env.example` for the
exact variable names and default local ports). `DATABASE_URL` points at
Postgres directly (port 54322 by default), not the Supabase API.

For Phase 1 payments locally, also set the `STRIPE_*` / `NEXT_PUBLIC_STRIPE_*`
vars in `.env.example` (test-mode values from dashboard.stripe.com), and run
`stripe listen --forward-to localhost:3000/api/webhooks/stripe` to get a
`STRIPE_WEBHOOK_SECRET` and forward events during local testing.

To run a single test file: `npx vitest run tests/rls/cross-tenant.test.ts`.

## Architecture

**Stack**: Next.js App Router + TypeScript, Tailwind + shadcn/ui (built on
`@base-ui/react`, not Radix — see the Base UI note below), Supabase
(Postgres/Auth/Realtime/Storage), Drizzle ORM, deployed on Vercel. Full
stack table is in the build spec section 2.

**Non-negotiable rules** (build spec section 3 — violating these is a
defect, not a style preference):
1. Server-authoritative outcomes — every draw, bid, payout calculation runs
   server-side, never on the client. `crypto.randomInt`, never `Math.random`.
2. Auditable randomness — every random outcome writes an immutable,
   append-only row (seed, algorithm, inputs, result, actor).
3. Webhooks are the source of truth for money — never write a ledger row
   from a client-side success callback.
4. RLS on every table, no exceptions. Service-role key never reaches the
   browser.
5. Every money-touching action writes an audit row.
6. Idempotency keys on every Stripe call.

### Auth and tenancy (what's actually built)

Auth is Supabase Auth, magic link (email) + phone OTP — no passwords,
anywhere. `src/lib/supabase/{client,server}.ts` are the `@supabase/ssr`
factories (browser vs. server component client); `src/middleware.ts` /
`src/lib/supabase/middleware.ts` refresh the session cookie on every
request per the standard `@supabase/ssr` pattern — don't remove the
`supabase.auth.getUser()` call in there even though the result looks
unused. The email flow round-trips through `src/app/auth/callback/route.ts`
(`exchangeCodeForSession`); phone OTP verifies client-side
(`verifyOtp({ type: "sms" })`) with no redirect needed.

`organizations` and `memberships` (`db/schema/*.ts`) are the only tables so
far. There is **no client-side INSERT policy on either table** — the only
way to create an org is the `create_organization()` Postgres function
(`db/migrations/0001_rls_policies.sql`, called via
`src/lib/organizations.ts`), which atomically inserts the org row and a
`role='owner'` membership row for `auth.uid()`. This mirrors rule 1
(server-authoritative outcomes) applied to org creation, and keeps the RLS
policies themselves trivial. When adding invite flows or other membership
writes later, follow the same shape: a `SECURITY DEFINER` function owned by
`postgres` (so it can bypass RLS internally), not a client-side INSERT
policy — see `is_org_member()` in the same migration for why (avoids RLS
self-recursion on `memberships`).

Table structure comes from `db/schema/*.ts` via `drizzle-kit generate`.
RLS policies and `SECURITY DEFINER` functions are hand-written SQL in
`db/migrations/*.sql` (drizzle's `pgPolicy` DSL doesn't cover functions, so
policies live alongside the functions they depend on rather than split
across two authoring paths). If you add a table, follow the same split:
columns via Drizzle, policies via a `drizzle-kit generate --custom` file.

### Money spine (Phase 1)

The donate flow is: organizer creates an org → connects Stripe (Connect
Standard, OAuth — `src/app/org/[orgSlug]/stripe/connect|callback/route.ts`)
→ creates a fundraiser (`src/lib/fundraisers.ts`, plain RLS INSERT policy
gated to owner/admin — unlike org creation there's no bootstrapping
problem here, so no RPC is needed) → guest hits the public donate page
(`src/app/donate/[orgSlug]/[fundraiserSlug]/page.tsx`) → Stripe Elements
confirms the payment client-side (card data never reaches our server) →
the webhook writes the ledger row.

**`src/lib/payments/webhook-handlers.ts` is the only place `transactions`
rows get written** (rule 3) — not the route handler, and not the
PaymentIntent-creation action. This split exists so the processing logic
can be tested directly against a real database with a fabricated Stripe
event (`tests/money/webhook-handlers.test.ts`), without a live Stripe API
or a running server. `src/app/api/webhooks/stripe/route.ts` is a thin
wrapper: verify the signature, call `processStripeEvent()`. Idempotency is
by Stripe event id (`stripe_webhook_events`, upsert + `ignoreDuplicates`) —
**event ids must be unique per test run**, since that table is never reset
between runs and a reused id is (correctly) treated as an already-processed
duplicate and silently skipped; see the `runId` suffix pattern in the money
tests.

Refunds are server-initiated only (`src/lib/payments/refund.ts`): it calls
`stripe.refunds.create` and writes an audit row for the *initiation*, but
the negative `transactions` row itself still comes from the
`charge.refunded` webhook, never from the action directly — same rule-3
reasoning. Never edit an original transaction row to reflect a refund or
dispute; both are separate rows/audit entries.

Guest checkout has no Supabase Auth session, so `participants` rows are
written via the service-role client (`src/lib/supabase/service.ts`) inside
the trusted `createDonationIntent` server action — there is no client-side
INSERT policy on `participants` at all, matching the "guest checkout must
work without an account" requirement. The one deliberate public RLS
exception in this codebase is in `db/migrations/0005_public_donate_policies.sql`:
`anon` can read `fundraisers` where `status = 'active'` and the parent
`organizations` row, because the donate page has to render for signed-out
visitors. Nothing exposed there is sensitive — a Stripe *account id*
(`acct_...`) is routinely used client-side, unlike an API key.

The platform fee is one constant: `PLATFORM_FEE_BPS` in
`src/lib/stripe/fees.ts`, currently `0`. Change that value when pricing is
decided; nothing else needs to move.

### Product module (Phase 2)

Validates the shared ledger under a real module, per the build spec's
Phase 2 goal. Shape: `modules` (type='product') belongs to a fundraiser;
`products` belong to a module; a checkout produces one `orders` row plus
one `order_items` row per line item. `db/schema/modules.ts` explains why
`org_id` is denormalized onto modules/products (and transactions) —
avoids a join in every RLS policy.

Unlike `organizations`/`participants`, module and product creation use
plain RLS INSERT policies gated to `is_org_admin()`
(`db/migrations/0007_phase2_policies.sql`) — same reasoning as
fundraisers: the actor already has a membership row, so there's no
bootstrapping problem requiring a `SECURITY DEFINER` RPC.

Checkout (`src/lib/payments/create-order-intent.ts`) mirrors
`createDonationIntent` almost exactly, with one addition: it recomputes
the order total **server-side from the current `products.price_cents`**,
never from anything the client sends — the cart on the client is just
`{productId: quantity}` UI state, not a source of truth. It creates the
`orders`/`order_items` rows as `status: "pending"` via the service role
*before* the PaymentIntent is confirmed; the webhook
(`handlePaymentIntentSucceeded` in `webhook-handlers.ts`) is what flips the
order to `"paid"` and links `transaction_id` once `payment_intent.succeeded`
actually arrives — same rule-3 shape as everything else. A failed payment
flips the order to `"failed"` with no ledger row, mirroring the donation
failure path. The PaymentIntent's `metadata.order_id` /
`metadata.module_id` are what let the webhook find the right order and
tag the transaction's `module_id` — donations never set `module_id` since
they aren't tied to a module.

The admin view lives at
`src/app/org/[orgSlug]/fundraisers/[fundraiserSlug]/page.tsx` (not the
top-level org dashboard — that would get unwieldy once more module types
exist): enable the product module, add products, and see order history
with guest name/total/line items via nested `select()` embeds
(`orders(...,participants(...),order_items(...,products(...)))`) rather
than separate queries. The public catalog is
`src/app/shop/[orgSlug]/[fundraiserSlug]/page.tsx`, readable by signed-out
guests via the same kind of `anon` policy exception as the donate page
(`"public can read active product modules/products"` in
`db/migrations/0007_phase2_policies.sql`). `StripeCheckoutStep`
(`src/components/payments/stripe-checkout-step.tsx`) is the Stripe
Elements mount-and-confirm step shared between `DonateForm` and
`ShopCart` — don't duplicate it a third time if a future module also ends
in a PaymentIntent confirmation.

### RLS testing

`tests/rls/cross-tenant.test.ts` (org/membership tables),
`tests/rls/phase1-cross-tenant.test.ts` (fundraisers/participants/
transactions/audit_log), and `tests/rls/phase2-cross-tenant.test.ts`
(modules/products/orders/order_items, plus the anon-read exceptions) are
the templates every future table's RLS test should follow: sign in real
users via the phone-OTP test flow (`[auth.sms.test_otp]` in
`supabase/config.toml` — fixed OTP codes for local dev, no live Twilio
needed; `tests/helpers.ts` has the shared `signInTestUser()` /
`createTestOrgWithFundraiser()` fixtures), then assert one tenant cannot
read, list, update, delete, or insert into another tenant's rows —
checking the *actual database state* via a service-role client afterward,
not just the client response shape. CI (`.github/workflows/ci.yml`) runs
both this suite and `test:money` on every push/PR and treats a failure as
a merge blocker, per build spec section 9.

**Every test file must use its own disjoint slice of `tests/helpers.ts`'s
`TEST_PHONES` indices (0-9) — never reuse an index another file also
uses.** gotrue rate-limits phone OTP requests to one per 5s *per number,
across all processes*, not per test file. This isn't hypothetical: adding
Phase 2's test files with everyone reusing indices 0-2 made the full suite
fail nearly every run. The comment above `TEST_PHONES` in `tests/helpers.ts`
tracks the current allocation — update it when you add a file that signs
in a test user. (Running the whole suite twice within ~5s of itself will
still hit the limit even with disjoint indices — that's the real rate
limiter working as intended, not a bug.)

### Local Supabase gotchas (verified empirically, not documented by Supabase)

- **Every new table needs an explicit `GRANT` in a migration, even with RLS
  policies in place.** Drizzle Kit applies migrations by connecting directly
  as `postgres`, which — unlike tables created through Supabase's own
  migration path — does *not* pick up Supabase's usual default privileges
  for `anon`/`authenticated`/`service_role`. Without a `GRANT`, every query
  fails with `permission denied for table X`, regardless of RLS; RLS only
  filters rows once a role already has the base object privilege. See
  `db/migrations/0002_grants.sql` for the pattern (`authenticated` gets
  exactly what its policies allow; `service_role` gets full CRUD since
  `BYPASSRLS` alone doesn't grant object access).
- **`[auth.sms.test_otp]` alone does not enable phone sign-in.** gotrue
  returns `400 phone_provider_disabled` unless some SMS provider block
  (`[auth.sms.twilio]` here) has `enabled = true` — the test_otp map is only
  consulted once phone auth is active. Local config enables the Twilio
  block with placeholder credentials that are never actually called, since
  every phone number used locally is in `test_otp`.
- **`[analytics]` is disabled in `supabase/config.toml`.** The local
  logflare/vector containers it spins up failed their health checks in this
  environment and caused `supabase start` to roll back the entire stack.
  Not needed for anything built so far — re-enable only if you have a
  concrete reason to inspect local log aggregation.

### Build/deploy gotchas (verified empirically)

- **Never construct an SDK client eagerly at module scope if it needs an
  env var.** `new Stripe(process.env.STRIPE_SECRET_KEY!)` at the top of
  `src/lib/stripe/client.ts` crashed `next build` during "Collecting page
  data" the first time this was deployed to a freshly-linked Vercel
  project (no env vars configured yet) — Next.js evaluates route/action
  modules at build time, before runtime env vars exist. Fixed by
  constructing lazily on first use (`getStripe()`); `db/client.ts` has the
  same latent risk if anything ever imports it directly (currently
  nothing does — app code goes through `src/lib/supabase/*` instead, see
  below).
- **`import "server-only"` breaks direct unit testing under Vitest.** The
  package's marker only no-ops under Next.js's "react-server" bundler
  condition; in plain Node it unconditionally throws. That's why
  `webhook-handlers.ts` — which `tests/money/` imports directly — does not
  have that import, even though every other server-only module in this
  repo does. Don't add it there.
- **App code never imports `db/client.ts`.** Despite it existing (for
  potential future scripts/seeding), all reads/writes go through
  `src/lib/supabase/{client,server,service}.ts` — an RLS-scoped
  `@supabase/ssr` client for anything user-facing, the service-role client
  only for the specific writes that have no client policy by design
  (`participants`, `transactions`, `audit_log`, `stripe_webhook_events`,
  and `organizations` updates like the Stripe callback / webhook). This
  avoids running a persistent `postgres.js` connection inside serverless
  functions, which doesn't pool well on Vercel without something like
  Supavisor in front of it.

### Production deployment

Production is `https://fundrally.vercel.app`, backed by a real hosted
Supabase project (linked via Supabase's official Vercel integration, not
manually-copied keys) and real migrations already applied. A few things
that weren't obvious setting this up:

- **The Supabase Vercel integration creates its own env var names**
  (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`,
  `POSTGRES_URL`, etc.), separate from what this app's code reads
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`). It turned out to also
  overwrite the latter set where names already existed (they'd been
  seeded with placeholders earlier to unblock a build) — but don't count
  on that; verify actual values after connecting a new integration rather
  than assuming a name match. `DATABASE_URL` isn't created by the
  integration at all; source it from `POSTGRES_URL_NON_POOLING` (direct
  connection — better than the pooled `POSTGRES_URL` for one-shot
  migration runs, which can be finicky through a transaction-mode pooler).
- **`NEXT_PUBLIC_*` vars are baked into the client bundle at build time**,
  not read at request time. Updating them in Vercel's dashboard does
  nothing to an already-built deployment — you need a fresh `vercel --prod`
  (or a new push) before the new values take effect client-side.
- **This sandboxed shell redacts real-looking secrets even mid-pipeline**,
  not just in what gets displayed back — a real Postgres connection string
  piped through `$(...)` into `DATABASE_URL` for a child process arrived
  at that process as the literal string `[SENSITIVE]`, not the real value
  (surfaced as a Postgres "Invalid URL" error). Applying migrations to a
  real hosted database from this environment doesn't work as a result;
  that has to be run by a human in a real terminal (`vercel env pull` +
  `drizzle-kit migrate` with the pulled `DATABASE_URL`).
- **Supabase Auth's Site URL / Redirect URLs are dashboard-only config**,
  not something in a migration — set under Authentication → URL
  Configuration to the production domain plus `/auth/callback` and
  `/org/*/stripe/callback`, or magic-link redirects and the Stripe Connect
  OAuth callback will point at the wrong place.

### Build phases

The build spec (section 8) sequences work as: Phase 0 foundation (done) →
Phase 1 money spine (done) → Phase 2 first module (done, product/cookie
sale) → Phase 3 reporting/payouts → Phase 4 compliance gating → Phase 5
auction → Phase 6 chance modules → Phase 7 golf → Phase 8 comms/sponsors.
Don't jump ahead — e.g. don't build chance-module UI before
`module_availability` gating exists (Phase 4), and don't assume a
`draws` table exists without checking `db/schema/` (Phase 6 is what
introduces it).

### Base UI note

shadcn/ui here is configured for `@base-ui/react`, not Radix. Its `Button`
has no `asChild` prop — use the `render` prop for polymorphism, **except**
for links: Base UI's own docs say `<a>` should never be rendered through
`Button`'s `render` prop (it has its own semantics). Style links directly
with the exported `buttonVariants()` instead (see `src/app/page.tsx` for the
pattern).
