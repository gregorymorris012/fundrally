-- Companion to 0023 (which added the queen_of_hearts/board_shuffle/
-- weekly_draw enum values and the cycle_number/card_number/quantity
-- columns): the partial unique indexes Drizzle's schema builder can't
-- express.
--
-- These predicates deliberately test cycle_number's NULLness, never the
-- literal enum value 'weekly_draw' — drizzle-kit's migrator runs every
-- pending file in ONE transaction, and referencing a just-added enum
-- value in an index predicate within that same transaction fails with
-- "unsafe use of new value ... New enum values must be committed before
-- they can be used" (Postgres error 55P04). This only bites drivers using
-- the extended/prepared-statement protocol (postgres.js, what drizzle-kit
-- uses) — psql's simple protocol doesn't hit it, which is a trap if you
-- verify by hand in psql and assume that proves the real migration is
-- safe. Filtering on cycle_number IS [NOT] NULL sidesteps the whole
-- class of bug rather than working around it.

-- draws: 0020 made every segment unique per module (one draw ever). Queen
-- of Hearts' weekly_draw breaks that — it repeats once per cycle — so
-- split the guarantee in two: anything with no cycle_number (every
-- existing segment, plus QoH's one-time board_shuffle) stays "once per
-- module"; anything WITH a cycle_number (QoH's weekly_draw) becomes "once
-- per (module, cycle)" instead.
DROP INDEX "draws_module_id_segment_unique";

CREATE UNIQUE INDEX "draws_module_id_segment_unique"
ON public.draws (module_id, segment)
WHERE cycle_number IS NULL;

CREATE UNIQUE INDEX "draws_module_id_cycle_segment_unique"
ON public.draws (module_id, cycle_number, segment)
WHERE cycle_number IS NOT NULL;

-- module_entries: one claim per board number per cycle (Queen of Hearts
-- only — card_number is null for every other module type). Numbers are
-- reused cycle to cycle (the board resets to "available" each week except
-- for positions already permanently revealed), so this can't be a
-- module-wide unique index the way squares' (module_id, position) is.
CREATE UNIQUE INDEX "module_entries_module_cycle_card_unique"
ON public.module_entries (module_id, cycle_number, card_number)
WHERE card_number IS NOT NULL;

-- No new grants needed: module_entries and draws already have everything
-- service_role/authenticated/anon need from 0012/0014/0020 — new columns
-- on an existing table don't need a new GRANT, and the existing SELECT
-- policies on both tables are row-scoped, not column-scoped, so they
-- automatically cover the new columns too.
