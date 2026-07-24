import { boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const organizationStatus = pgEnum("organization_status", [
  "active",
  "suspended",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  stripeAccountId: text("stripe_account_id"),
  // Set from the Connect `account.updated` webhook, never guessed
  // client-side. "block all module activation until connected" (build spec
  // section 5) means: check chargesEnabled, not just stripeAccountId being
  // non-null — a connected account can still be mid-onboarding.
  chargesEnabled: boolean("charges_enabled").notNull().default(false),
  payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
  stateCode: text("state_code").notNull(),
  status: organizationStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
