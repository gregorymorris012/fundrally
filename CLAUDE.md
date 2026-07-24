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

Currently implemented: **Phase 0 only** — auth, `organizations`,
`memberships`, and RLS. No fundraiser modules, no payments, no money spine
yet. Don't assume later-phase tables (`transactions`, `draws`, `modules`,
etc.) exist; check `db/schema/` before referencing them.

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
```

Local dev setup: `supabase start`, then copy the printed `API URL`, `anon
key`, and `service_role key` into `.env.local` (see `.env.example` for the
exact variable names and default local ports). `DATABASE_URL` points at
Postgres directly (port 54322 by default), not the Supabase API.

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

### RLS testing

`tests/rls/cross-tenant.test.ts` is the template every future table's RLS
test should follow: sign in two real users via the phone-OTP test flow
(`[auth.sms.test_otp]` in `supabase/config.toml` — fixed OTP codes for local
dev, no live Twilio needed), have each create their own org via
`create_organization()`, then assert user A cannot read, list, update,
delete, or insert into user B's rows — checking the *actual database state*
via a service-role client afterward, not just the client response shape.
CI (`.github/workflows/ci.yml`) runs this suite on every push/PR and treats
a failure as a merge blocker, per build spec section 9.

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

### Build phases

The build spec (section 8) sequences work as: Phase 0 foundation (done) →
Phase 1 money spine (Stripe Connect, PaymentIntents, webhook handler,
ledger) → Phase 2 first module (product sales) → Phase 3 reporting/payouts
→ Phase 4 compliance gating → Phase 5 auction → Phase 6 chance modules →
Phase 7 golf → Phase 8 comms/sponsors. Don't jump ahead — e.g. don't build
chance-module UI before `module_availability` gating exists (Phase 4), and
don't write to a `transactions` table that doesn't exist yet without first
checking `db/schema/`.

### Base UI note

shadcn/ui here is configured for `@base-ui/react`, not Radix. Its `Button`
has no `asChild` prop — use the `render` prop for polymorphism, **except**
for links: Base UI's own docs say `<a>` should never be rendered through
`Button`'s `render` prop (it has its own semantics). Style links directly
with the exported `buttonVariants()` instead (see `src/app/page.tsx` for the
pattern).
