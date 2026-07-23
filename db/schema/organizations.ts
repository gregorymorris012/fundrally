import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const organizationStatus = pgEnum("organization_status", [
  "active",
  "suspended",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  stripeAccountId: text("stripe_account_id"),
  stateCode: text("state_code").notNull(),
  status: organizationStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
