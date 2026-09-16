import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { fundraisers } from "./fundraisers";

// build spec section 4: type values are auction | wheel | product | squares
// | fifty_fifty | golf | item_raffle. Only `product` is implemented
// (Phase 2) — the rest are Phase 5/6/7. Active deviation from that order
// (see CLAUDE.md "Current deviations from the build spec"): chance-based
// types (wheel, squares, fifty_fifty, item_raffle) may get backend +
// org-admin management UI now, gated by a module_availability compliance
// flag and demo-mode only — but no real-money checkout path on any of
// them until Phase 4's full compliance work lands, regardless of that
// flag or Stripe status. Nothing in this file enforces either gate yet.
export const moduleType = pgEnum("module_type", [
  "auction",
  "wheel",
  "product",
  "squares",
  "fifty_fifty",
  "golf",
  "item_raffle",
]);

export const moduleStatus = pgEnum("module_status", [
  "draft",
  "active",
  "closed",
  "paused",
]);

// org_id is denormalized off fundraisers (same reasoning as
// transactions.org_id) so RLS policies here don't need a join.
//
// Squares-only shape of `config` (other chance types don't use these
// keys). Still plain jsonb — widening this shape needs no migration, same
// non-migration updateSquaresLabels already relied on for rowLabel/
// colLabel. IMPORTANT: `config` is anon-readable table-wide (the
// "public can read active chance modules" policy is row-scoped, not
// column-scoped — Postgres grants/RLS don't filter individual JSON keys),
// so anything stored here is fetchable by any signed-out caller who hits
// the Supabase REST API directly for an active module, not just through
// this app's pages. joinPasswordHash is a low-stakes access gate (keeps
// casual guests off an unlisted board), not a security boundary — never
// put an actual secret in this object.
export type SquaresConfig = {
  rowLabel?: string;
  colLabel?: string;
  rowColor?: string; // hex, e.g. "#0f4c81" — manual picker, not real team data
  colColor?: string;
  pricePerSquareCents?: number; // unset/0 = no price shown (legacy free-demo behavior)
  joinPasswordHash?: string | null; // sha256 hex digest; null/absent = no gate
  locked?: boolean; // admin toggle independent of `status` — stops new claims only
  payoutStructure?: "final_only" | "half_final" | "quarters"; // default: final_only
  espnEventId?: string | null; // provenance only, from an optional ESPN lookup
};

export const modules = pgTable("modules", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fundraiserId: uuid("fundraiser_id")
    .notNull()
    .references(() => fundraisers.id, { onDelete: "cascade" }),
  type: moduleType("type").notNull(),
  // Organizer-facing label ("Lions vs. Saints Squares", "Fall Cookie
  // Sale") — a real column, not a config key, since naming is a concern
  // shared by every module type (not squares-specific like config is),
  // and matters as soon as an org has more than one module of the same
  // type (otherwise the modules list is just a wall of identical type
  // labels). Nullable: falls back to the type label when unset.
  name: text("name"),
  config: jsonb("config").notNull().default({}),
  status: moduleStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
