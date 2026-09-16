-- Supersede the one-draw-per-module guarantee (0015_draws_module_unique.sql)
-- now that a squares module can be configured for up to 4 independent
-- segment draws (payoutStructure in modules.config: final_only/half_final/
-- quarters). Same reasoning as 0015: the real guarantee is this DB-level
-- constraint, not drawSquaresCore's application-level pre-check, which
-- still has a race window between two concurrent "Draw numbers" clicks for
-- the same segment.
DROP INDEX "draws_module_id_unique";

CREATE UNIQUE INDEX "draws_module_id_segment_unique"
ON public.draws (module_id, segment);

-- No new grants needed for either changed table:
--   module_entries: service_role already has SELECT, INSERT, UPDATE,
--   DELETE (0012_module_entries_policies.sql) — the UPDATE needed for
--   mark-paid/void/release/lock already exists.
--   draws: service_role already has SELECT, INSERT only
--   (0014_draws_and_squares_positions.sql) — correct and unchanged, a
--   draw stays append-only per segment, never updated or deleted.
-- No RLS policy changes needed either: the anon/authenticated SELECT
-- policies on module_entries and draws (0012, 0014) are row-scoped
-- (modules.status = 'active' AND fundraisers.status = 'active'), not
-- column-scoped, so the new columns on both tables are automatically
-- covered by the existing policies.
