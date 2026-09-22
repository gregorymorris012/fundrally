import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { modules } from "./modules";
import { transactions } from "./transactions";

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
  // Squares only (0-99, a 10x10 grid) — null for raffle/50-50/wheel, which
  // have no grid concept. A partial unique index (module_id, position)
  // WHERE position IS NOT NULL, added by hand in
  // 0014_draws_and_squares_positions.sql since Drizzle's schema builder
  // doesn't cleanly express a partial unique constraint, is what actually
  // stops two guests claiming the same square — this column alone doesn't
  // enforce that.
  position: integer("position"),
  // Squares-only price tracking (still free/no-checkout — see the module
  // comment above; CLAUDE.md's compliance gate blocks real chance-module
  // checkout, not the ability to *track* a price an organizer collects in
  // person). priceCents snapshots modules.config.pricePerSquareCents at
  // the moment this square was claimed, so a later price change on the
  // module never retroactively changes what an already-claimed square
  // owes — same reasoning as order_items snapshotting unit_price_cents
  // instead of reading live products.price_cents. transactionId links to
  // the real transactions row created by markSquarePaidCore (via the
  // existing addOfflineGiftCore, not a new payment path) once an org
  // admin manually confirms they collected payment. Paid = transactionId
  // is set. Claimed-but-unpaid = position is set and transactionId isn't.
  // Released = position is null (nulled, not deleted, so the claim's
  // history survives for the activity log) — deliberately no separate
  // status enum column since these two columns plus position already
  // derive every state without redundant storage.
  priceCents: integer("price_cents"),
  transactionId: uuid("transaction_id").references(() => transactions.id, {
    onDelete: "set null",
  }),
  // Queen of Hearts only, below — null for every other module type, same
  // pattern as `position` above. A QoH game runs in weekly cycles (a
  // drawing either pays a consolation prize and rolls to the next cycle,
  // or hits the Queen and ends the game); an entry belongs to exactly one
  // cycle. cardNumber (1-54) is the board position this entry picked, or
  // null for a "day-of" entry that only picks live if it's drawn. A
  // partial unique index (module_id, cycle_number, card_number) WHERE
  // card_number IS NOT NULL — added by hand in the migration, same reason
  // as the squares one above — enforces one claim per number per cycle
  // (each cycle reuses the same 1-54 numbering, so this can't be a plain
  // module-wide unique index the way squares' is).
  cycleNumber: integer("cycle_number"),
  cardNumber: integer("card_number"),
  // How many entries this row represents (buying "3 tickets" is one row,
  // quantity 3, not three rows) — weights the weekly weighted draw.
  // Defaults to 1 so every existing/other-module-type row has a
  // well-defined quantity without a backfill.
  quantity: integer("quantity").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
