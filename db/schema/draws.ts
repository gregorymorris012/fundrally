import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { modules } from "./modules";

// Build spec rule 1 (server-authoritative outcomes: crypto.randomInt, never
// Math.random) and rule 2 (auditable randomness: every random outcome
// writes an immutable, append-only row — seed, algorithm, inputs, result,
// actor). This table is scoped for now to squares' row/column digit draw
// (src/lib/draws.ts) — CLAUDE.md flags a general-purpose `draws` table as
// Phase 6 work; this is a narrower, squares-only version pulled forward
// for the same reason chance modules themselves were (see CLAUDE.md
// "Current deviations from the build spec"). No client write policy at
// all, same as audit_log — only server code via the service role ever
// inserts here, and nothing ever updates or deletes a row.

// One value per configured payout segment (modules.config.payoutStructure):
// final_only -> [final], half_final -> [half, final], quarters -> [q1, q2,
// q3, final]. A single enum spans every structure rather than one per
// structure — "final" always means "the game's final score," whichever
// structure is configured. See SEGMENTS_BY_STRUCTURE in src/lib/draws.ts.
//
// board_shuffle / weekly_draw are Queen of Hearts' (src/lib/queen-of-hearts/):
// board_shuffle is the one-time random assignment of the 54-card deck to
// board positions; weekly_draw is that game's weighted pick of a winning
// entry, one per cycle (see cycleNumber below) rather than once per module.
export const drawSegment = pgEnum("draw_segment", [
  "q1",
  "q2",
  "q3",
  "half",
  "final",
  "board_shuffle",
  "weekly_draw",
]);

export const draws = pgTable("draws", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  // Defaults to 'final' so every pre-existing row (drawn back when a
  // module only ever got one draw, ever) backfills as that draw's segment
  // — a lone draw always represented the game's (only, final) score under
  // the implicit final_only behavior this table originally had.
  //
  // Uniqueness (see db/migrations for the partial indexes Drizzle can't
  // express, and why they key off cycleNumber's NULLness rather than the
  // segment value itself): a draw with no cycleNumber gets exactly one row
  // per module ((module_id, segment) unique) — that covers squares'
  // single 'final' draw and Queen of Hearts' single 'board_shuffle'. A
  // draw WITH a cycleNumber (Queen of Hearts' weekly_draw) instead gets
  // exactly one row per (module_id, cycle_number), since that game has a
  // new draw every cycle it doesn't end on.
  segment: drawSegment("segment").notNull().default("final"),
  // Queen of Hearts' weekly_draw only — null for every other segment. See
  // the uniqueness note above; there is no notion of a "cycle" for squares.
  cycleNumber: integer("cycle_number"),
  algorithm: text("algorithm").notNull(),
  inputs: jsonb("inputs").notNull(),
  result: jsonb("result").notNull(),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
