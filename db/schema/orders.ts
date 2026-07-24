import {
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { fundraisers } from "./fundraisers";
import { modules } from "./modules";
import { participants } from "./participants";
import { transactions } from "./transactions";
import { products } from "./products";

export const orderStatus = pgEnum("order_status", [
  "pending",
  "paid",
  "failed",
]);

// Created (status='pending') by createOrderIntent *before* the
// PaymentIntent is confirmed, then flipped to 'paid' and linked to its
// transactions row by the webhook handler once payment_intent.succeeded
// arrives — same rule-3 reasoning as everything else money-related:
// the webhook is what makes it real, not the checkout request.
export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fundraiserId: uuid("fundraiser_id")
    .notNull()
    .references(() => fundraisers.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id, { onDelete: "restrict" }),
  transactionId: uuid("transaction_id").references(() => transactions.id, {
    onDelete: "set null",
  }),
  status: orderStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

// unit_price_cents is a snapshot at order time — a later price change on
// `products` must never alter the amount on a past order.
export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
}).enableRLS();
