import { boolean, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { moduleType } from "./modules";

// Active deviation, pulled forward from Phase 4 (see CLAUDE.md "Current
// deviations from the build spec"): lets chance-based module types get
// backend + org-admin management UI now instead of waiting for the full
// Phase 4 compliance system. This table only gates whether an org can
// create/manage a demo-mode module of a given type — it does not, and
// structurally cannot, gate real-money checkout, because no checkout code
// path exists yet for any chance-based module type. That absence is what
// actually keeps this demo-only; Phase 4 is what introduces a real
// checkout path, not a column here.
export const moduleAvailability = pgTable(
  "module_availability",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    moduleType: moduleType("module_type").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("module_availability_org_type_unique").on(
      table.orgId,
      table.moduleType,
    ),
  ],
).enableRLS();
