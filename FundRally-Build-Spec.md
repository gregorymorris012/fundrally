# FundRally — Build Spec

**Status:** Greenfield. Nothing built.
**Audience:** Claude Code / implementing engineer.
**Last updated:** July 2026

---

## 1. What this is

A multi-tenant platform where nonprofit organizers run community fundraisers and
guests participate and pay from their phones. Multiple fundraiser formats live
under a single event, with one unified ledger and reporting layer.

**Primary constraint:** the platform never holds charitable funds and never
touches card data.

**Secondary constraint:** every fundraiser format must be independently
enable-able per tenant, because gaming law varies by state.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router), TypeScript | Deployed on Vercel |
| Styling | Tailwind + shadcn/ui | No custom design system in v1 |
| Database | Postgres via Supabase | RLS enforced on every table |
| ORM | Drizzle | Migrations checked into repo |
| Auth | Supabase Auth — magic link + phone OTP | No passwords |
| Realtime | Supabase Realtime | Postgres changes + broadcast channels |
| Files | Supabase Storage | Item photos, sponsor logos |
| Payments | Stripe Connect — Standard accounts, direct charges | Fee via `application_fee_amount` |
| SMS | Twilio | 10DLC registration must start in week 1 |
| Email | Resend | Transactional only |
| Errors | Sentry | |
| Analytics | PostHog | |
| Delivery | PWA (installable), no native apps in v1 | |

---

## 3. Non-negotiable architectural rules

These are not preferences. Violating any of them is a defect.

1. **Server-authoritative outcomes.** Every draw, spin, race result, bid
   acceptance, and payout calculation executes in a server route handler or Edge
   Function. Never on the client. Use `crypto.randomInt` — never `Math.random`.

2. **Auditable randomness.** Every random outcome writes an immutable row
   containing: the seed, the algorithm, the input set, the result, a timestamp,
   and the acting user. Append-only. Never updated, never deleted.

3. **Webhooks are the source of truth for money.** No transaction is written to
   the ledger based on a client-side success callback. The Stripe webhook writes
   it. The client only navigates.

4. **RLS on every table, no exceptions.** No table ships without a policy. The
   service-role key is used only in server contexts that explicitly need it, and
   never reaches the browser.

5. **Every money-touching action writes an audit row.** Actor, action, before
   state, after state, timestamp.

6. **Idempotency keys on every Stripe call.** Assume every request may be retried.

---

## 4. Data model

### Tenancy

```
organizations
  id, name, slug, stripe_account_id, state_code,
  status, created_at

memberships
  id, org_id, user_id, role  -- owner | admin | volunteer

compliance_records
  id, org_id, record_type,   -- 501c3 | solicitation_reg | gaming_license
  jurisdiction, identifier, expires_at, verified_at, document_path
```

### Events and modules

```
fundraisers
  id, org_id, title, slug, starts_at, ends_at, status, cover_image_path

modules
  id, fundraiser_id, type, config jsonb, status
  -- type: auction | wheel | product | squares | fifty_fifty | golf | item_raffle

module_availability
  id, org_id, module_type, enabled, enabled_reason, enabled_by, enabled_at
  -- the compliance gate; a module cannot go live without a row here
```

### The shared ledger — every module writes here

```
transactions
  id, org_id, fundraiser_id, module_id, participant_id,
  kind,               -- purchase | bid_win | donation | refund | fee
  gross_cents, fee_cents, net_cents, currency,
  stripe_payment_intent_id, stripe_charge_id,
  status, created_at

payouts
  id, org_id, module_id, participant_id, item_description,
  amount_cents, method, status, mailed_at, notes

draws
  id, module_id, algorithm, seed, input_set jsonb,
  result jsonb, created_at, created_by
  -- append only
```

### Participants

```
participants
  id, org_id, user_id nullable, display_name, email, phone
  -- user_id nullable: guest checkout must work without an account
```

### Per-module tables

Each module owns its own tables (`auction_items`, `bids`, `squares_grid`,
`squares_claims`, `raffle_tickets`, `wheel_entries`, `golf_teams`,
`golf_scores`, `products`, `orders`). They never write financial truth directly
— they reference a `transactions` row.

---

## 5. Payments flow

```
Organizer onboarding
  → Stripe Connect OAuth, Standard account
  → store stripe_account_id on organizations
  → block all module activation until connected

Purchase
  → server creates PaymentIntent ON the connected account
     (Stripe-Account header), with application_fee_amount
  → client confirms with Stripe Elements (card data never hits our server)
  → webhook payment_intent.succeeded → write transactions row
  → realtime broadcast → UI updates

Refund
  → server-initiated only, against the connected account
  → writes a negative transactions row, never edits the original
```

**Webhook events to handle:** `payment_intent.succeeded`,
`payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`,
`account.updated`.

Store every webhook payload raw before processing. Process idempotently by event ID.

---

## 6. Realtime channels

| Channel | Mechanism | Carries |
|---|---|---|
| `fundraiser:{id}` | Postgres changes | Totals, module status |
| `auction:{module_id}` | Postgres changes | New bids, outbid state |
| `draw:{module_id}` | Broadcast | Spin/draw animation frames, synced across phones + projector |
| `golf:{module_id}` | Postgres changes | Live leaderboard |
| `presentation:{module_id}` | Broadcast | Big-screen display state |

Presentation mode is an unauthenticated route keyed by a short-lived join code.

---

## 7. Connectivity requirements

Venue wifi is assumed to be bad. Every interaction must:

- Show optimistic UI with a clear pending state
- Queue and retry on reconnect
- Never double-charge on retry (idempotency keys)
- Degrade to a "reconnecting" banner rather than a blank screen
- Survive a full page refresh mid-transaction without losing state

---

## 8. Build phases

**Phase 0 — Foundation**
Repo, Supabase project, auth, organizations, memberships, RLS policies, RLS test
suite in CI. No features. Do not proceed until cross-tenant tests pass.

**Phase 1 — Money spine**
Stripe Connect onboarding, PaymentIntent creation, webhook handler, transactions
ledger, refunds. Prove end-to-end with a single trivial "donate" flow.

**Phase 2 — First module: product/cookie sale**
Simplest format. Catalog, cart, checkout, order history. Validates the shared
layer under a real module.

**Phase 3 — Reporting + payouts**
Organizer dashboard reading only from `transactions`. Payout/mailing ledger.
Nothing reads module tables for financial figures.

**Phase 4 — Compliance gating**
`module_availability`, `compliance_records`, admin approval flow. Must exist
before any chance-based module ships.

**Phase 5 — Auction**
Bidding, bid history, outbid notifications, close-and-charge.

**Phase 6 — Chance modules**
50/50, item raffle, prize wheel, squares. Each requires the `draws` audit trail.
Ship behind gating only.

**Phase 7 — Golf**
Largest module. Formats, hole sponsorships, live leaderboard, GPS capture.

**Phase 8 — Comms + sponsors**
Twilio/Resend templates, activity log, sponsor wall.

---

## 9. Testing requirements

- **RLS tests are mandatory and run in CI.** For every table, assert that a user
  in org A cannot read, write, or update rows in org B. A failing RLS test blocks
  merge.
- **Money tests:** every transaction path has a test covering success, failure,
  retry, refund, and dispute.
- **Draw tests:** verify distribution over a large sample and verify that a draw
  row is always written.
- **Load test** before the first live event: 200 concurrent participants on one
  auction.

---

## 10. Non-goals for v1

- Native iOS/Android apps
- CRM integrations (Bloomerang, Salesforce NPSP) — designed for, not built
- Custom per-tenant domains
- Offline-first / local persistence
- Any microservice split
- Multi-currency

---

## 11. Environment and conventions

- Environments: local → Vercel preview per PR → production
- Supabase branching for schema changes; migrations in `/db/migrations`
- Secrets in Vercel env vars; never committed
- Seed script produces two orgs, three fundraisers, and sample participants for
  every module — required for testing tenant isolation
- Conventional commits; PRs squash-merged
- No feature merges while RLS tests are red
