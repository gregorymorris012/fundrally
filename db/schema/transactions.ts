import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { fundraisers } from "./fundraisers";
import { participants } from "./participants";

export const transactionKind = pgEnum("transaction_kind", [
  "purchase",
  "bid_win",
  "donation",
  "refund",
  "fee",
]);

export const transactionStatus = pgEnum("transaction_status", [
  "succeeded",
  "failed",
  "refunded",
  "disputed",
]);

// Written ONLY by the Stripe webhook handler (build spec rule 3:
// "webhooks are the source of truth for money" — never from a client-side
// success callback). Refunds are a separate negative row, never an edit of
// the original (build spec section 5). module_id has no FK yet because the
// `modules` table doesn't exist until a later phase; add the constraint
// when it does.
export const transactions = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fundraiserId: uuid("fundraiser_id")
    .notNull()
    .references(() => fundraisers.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id"),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id, { onDelete: "restrict" }),
  kind: transactionKind("kind").notNull(),
  grossCents: integer("gross_cents").notNull(),
  feeCents: integer("fee_cents").notNull(),
  netCents: integer("net_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeChargeId: text("stripe_charge_id"),
  status: transactionStatus("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
