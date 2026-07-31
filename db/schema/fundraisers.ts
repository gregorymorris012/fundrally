import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const fundraiserStatus = pgEnum("fundraiser_status", [
  "draft",
  "active",
  "closed",
]);

export const fundraisers = pgTable(
  "fundraisers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    goalAmountCents: integer("goal_amount_cents"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: fundraiserStatus("status").notNull().default("draft"),
    coverImagePath: text("cover_image_path"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("fundraisers_org_slug_unique").on(table.orgId, table.slug)],
).enableRLS();
