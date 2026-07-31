import {
  type AnyPgColumn,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { organizations } from "./organizations";
import { fundraisers } from "./fundraisers";
import { participants } from "./participants";
import { modules } from "./modules";

export const transactionKind = pgEnum("transaction_kind", [
  "purchase",
  "bid_win",
  "donation",
  "refund",
  "fee",
  // Manual-entry correction row (CLAUDE.md ledger invariants): a posted
  // transaction is never edited in place, so fixing a bad offline-gift
  // entry means a new 'adjustment' row referencing the original via
  // adjusts_transaction_id, same shape as a Stripe 'refund' row.
  "adjustment",
]);

export const transactionMethod = pgEnum("transaction_method", [
  "stripe",
  "cash",
  "check",
  "in_kind",
  "other",
]);

export const transactionStatus = pgEnum("transaction_status", [
  "succeeded",
  "failed",
  "refunded",
  "disputed",
]);

// Written by the Stripe webhook handler for method='stripe' rows (build
// spec rule 3: "webhooks are the source of truth for money" — never from a
// client-side success callback), or by the offline-gift-entry action for
// manual rows. Those are the only two writers (CLAUDE.md: "transactions is
// the single source of financial truth... Stripe is one writer, not the
// ledger itself"). Neither writer edits a row in place — corrections are a
// new row (kind='refund' for Stripe, kind='adjustment' for manual)
// referencing the original via adjusts_transaction_id.
export const transactions = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fundraiserId: uuid("fundraiser_id")
    .notNull()
    .references(() => fundraisers.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id").references(() => modules.id, { onDelete: "set null" }),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id, { onDelete: "restrict" }),
  kind: transactionKind("kind").notNull(),
  method: transactionMethod("method").notNull().default("stripe"),
  grossCents: integer("gross_cents").notNull(),
  feeCents: integer("fee_cents").notNull(),
  netCents: integer("net_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeChargeId: text("stripe_charge_id"),
  status: transactionStatus("status").notNull(),
  // Manual-entry-only fields (null on Stripe rows): who logged it, the
  // donor-given date (vs. created_at, when it was entered into the
  // system), and an optional check #/note.
  enteredBy: uuid("entered_by").references(() => authUsers.id, {
    onDelete: "set null",
  }),
  enteredAt: timestamp("entered_at", { withTimezone: true }),
  reference: text("reference"),
  adjustsTransactionId: uuid("adjusts_transaction_id").references(
    (): AnyPgColumn => transactions.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
