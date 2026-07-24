import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Not in the build spec's data model table list, but required by section 5
// ("Store every webhook payload raw before processing. Process
// idempotently by event ID.") and rule 3. Primary key is Stripe's own
// event id, so a second delivery of the same event is a no-op INSERT
// (ON CONFLICT DO NOTHING) rather than a duplicated ledger write.
// Service-role only — no client policy exists.
export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}).enableRLS();
