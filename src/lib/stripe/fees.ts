// Platform fee on each donation, in basis points (1/100 of a percent).
// Set to 0 for now — Phase 1's job is to prove the money spine works
// end-to-end, not to finalize pricing. Change this one constant when
// that's decided; nothing else needs to move.
export const PLATFORM_FEE_BPS = 0;

export function computeFeeCents(grossCents: number): number {
  return Math.round((grossCents * PLATFORM_FEE_BPS) / 10_000);
}
