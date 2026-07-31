import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { modules } from "./modules";

// Free, no-money participation record for chance-based mini-games (squares,
// 50/50, item raffle, prize wheel) — CLAUDE.md's active deviation blocks
// real-money checkout for these until Phase 4 compliance lands, so this is
// deliberately NOT a transactions row: a guest "joining" a mini-game here
// never touches the ledger. display_name is denormalized rather than
// referencing `participants` — keeps this table's write path fully public
// (service-role, same as guest checkout) without expanding what `participants`
// needs to expose to anon. Actual dollars raised at a mini-game reach the
// master fundraiser through the existing offline-gift-entry path
// (src/lib/payments/offline-gift.ts), tagged to this module's id — that's a
// separate, real transactions row, reconciled by the organizer.
export const moduleEntries = pgTable("module_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
