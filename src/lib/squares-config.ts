// Squares-only shape of modules.config (see db/schema/modules.ts for the
// full field-by-field rationale, including the anon-readability caveat —
// app code never imports db/schema directly, per this codebase's existing
// boundary, so this type is declared again here rather than imported).
// Lives outside src/lib/modules.ts specifically because that file is
// "use server" and Next.js requires every export from a "use server" file
// to be an async function — a plain type/object export like this one
// isn't allowed there (breaks the production build otherwise).
export type SquaresConfig = {
  rowLabel?: string;
  colLabel?: string;
  rowColor?: string;
  colColor?: string;
  pricePerSquareCents?: number;
  joinPasswordHash?: string | null;
  locked?: boolean;
  payoutStructure?: "final_only" | "half_final" | "quarters";
  espnEventId?: string | null;
};

export type DrawSegment = "q1" | "q2" | "q3" | "half" | "final";

export const SEGMENTS_BY_STRUCTURE: Record<
  NonNullable<SquaresConfig["payoutStructure"]>,
  DrawSegment[]
> = {
  final_only: ["final"],
  half_final: ["half", "final"],
  quarters: ["q1", "q2", "q3", "final"],
};
