-- One draw per module, enforced at the database level rather than trusting
-- drawSquaresCore's check-then-insert alone (src/lib/draws.ts) — that
-- pre-check has a real race window (two concurrent "Draw numbers" clicks
-- could both pass it before either insert lands), and build spec rule 2
-- treats this as a fairness-critical, immutable outcome, not something
-- that should be able to happen twice under any circumstance.
CREATE UNIQUE INDEX "draws_module_id_unique"
ON public.draws (module_id);
