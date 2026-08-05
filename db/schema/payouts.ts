import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const payoutStatus = pgEnum("payout_status", [
  "pending",
  "in_transit",
  "paid",
  "failed",
  "canceled",
]);

// Phase 3 ("Reporting + payouts", FundRally-Build-Spec.md section 8) —
// a read-only mirror of Stripe's own payout objects, not a ledger FundRally
// writes to. This app uses Stripe Connect direct charges: each org's
// connected account holds its own balance and pays itself out to its own
// bank account on its own schedule. FundRally never initiates a payout —
// only src/lib/payments/webhook-handlers.ts writes here, from
// payout.created/updated/paid/failed events (rule 3, same as transactions).
//
// Unlike `transactions`, this table IS updated in place — a payout is one
// Stripe object (stripe_payout_id) that transitions through states over
// its life (pending -> in_transit -> paid, or -> failed), and Stripe's
// webhooks represent state changes of that same object, not new discrete
// monetary events. Upserted by stripe_payout_id on every payout.* event —
// same shape as `orders.status`, not `transactions`.
//
// amount_cents will not reconcile against sum(transactions.net_cents):
// Stripe's own processing fee is deducted directly from the connected
// account's balance and isn't reflected anywhere in this app's ledger, so
// payouts always run lower than net raised. That's expected, not a bug —
// see the "Payouts" page for the explanatory copy.
export const payouts = pgTable("payouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  stripePayoutId: text("stripe_payout_id").notNull().unique(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  status: payoutStatus("status").notNull(),
  arrivalDate: timestamp("arrival_date", { withTimezone: true }),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
