import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
export const draws = pgTable("draws", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  algorithm: text("algorithm").notNull(),
  inputs: jsonb("inputs").notNull(),
  result: jsonb("result").notNull(),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
