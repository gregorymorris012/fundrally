import { authUsers } from "drizzle-orm/supabase";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

// user_id is nullable on purpose: guest checkout must work without an
// account (build spec section 4). Rows are written only by server code
// running as the service role — see db/migrations/0003_phase1_policies.sql
// for why there's no client-side INSERT policy here.
export const participants = pgTable("participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => authUsers.id, {
    onDelete: "set null",
  }),
  displayName: text("display_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
