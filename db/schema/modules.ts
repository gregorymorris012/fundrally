import { jsonb, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { fundraisers } from "./fundraisers";

// build spec section 4: type values are auction | wheel | product | squares
// | fifty_fifty | golf | item_raffle. Only `product` is implemented
// (Phase 2) — the rest are Phase 5/6/7 and, per section 4's
// module_availability table, the chance-based ones (wheel, squares,
// fifty_fifty, item_raffle) cannot go live without Phase 4's compliance
// gating. Nothing in this file enforces that yet; don't build UI for
// those types before that gate exists.
export const moduleType = pgEnum("module_type", [
  "auction",
  "wheel",
  "product",
  "squares",
  "fifty_fifty",
  "golf",
  "item_raffle",
]);

export const moduleStatus = pgEnum("module_status", [
  "draft",
  "active",
  "closed",
]);

// org_id is denormalized off fundraisers (same reasoning as
// transactions.org_id) so RLS policies here don't need a join.
export const modules = pgTable("modules", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fundraiserId: uuid("fundraiser_id")
    .notNull()
    .references(() => fundraisers.id, { onDelete: "cascade" }),
  type: moduleType("type").notNull(),
  config: jsonb("config").notNull().default({}),
  status: moduleStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
