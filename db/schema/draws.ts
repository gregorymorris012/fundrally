import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
export const drawSegment = pgEnum("draw_segment", ["q1", "q2", "q3", "half", "final"]);

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
  // the implicit final_only behavior this table originally had. A unique
  // index on (module_id, segment) — not module_id alone — is what lets a
  // module now be drawn once per configured segment instead of once ever;
  // see db/migrations for the migration that supersedes the old
  // module-id-only uniqueness.
  segment: drawSegment("segment").notNull().default("final"),
  algorithm: text("algorithm").notNull(),
  inputs: jsonb("inputs").notNull(),
  result: jsonb("result").notNull(),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
