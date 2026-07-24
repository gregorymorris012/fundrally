import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

// Build spec rule 5: "Every money-touching action writes an audit row.
// Actor, action, before state, after state, timestamp." Append-only —
// service-role only, no client UPDATE/DELETE policy, and no client INSERT
// policy either (rows come from server code, same as `transactions`).
// `actor` is either a user id (as text) or a system label such as
// "stripe_webhook".
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
