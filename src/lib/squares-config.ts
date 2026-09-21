// Squares-only shape of modules.config (see db/schema/modules.ts for the
// full field-by-field rationale, including the anon-readability caveat —
// app code never imports db/schema directly, per this codebase's existing
// boundary, so this type is declared again here rather than imported).
// Lives outside src/lib/modules.ts specifically because that file is
// "use server" and Next.js requires every export from a "use server" file
// to be an async function — a plain type/object export like this one
// isn't allowed there (breaks the production build otherwise).

// A scoring window that pays a winner. "half" is the end of the 2nd
// quarter; "final" is the end of the game, overtime included.
export type SquaresPeriod = "q1" | "half" | "q3" | "final";

export type PayoutStructure = "final_only" | "half_final" | "quarters";

export type SquaresConfig = {
  // Team across the top (columns) / down the side (rows). By convention the
  // away team is on top and the home team on the side; the winning square is
  // the intersection of the top team's last score digit (column) and the
  // side team's last score digit (row).
  rowLabel?: string;
  colLabel?: string;
  rowColor?: string;
  colColor?: string;
  pricePerSquareCents?: number;
  joinPasswordHash?: string | null;
  locked?: boolean;
  payoutStructure?: PayoutStructure;
  espnEventId?: string | null;
  // Visual 1-100 label on each square; defaults to on. Purely cosmetic —
  // positions stay 0-99 internally and this never affects picks or scoring.
  showSquareNumbers?: boolean;
  // Share of the pot (100 squares x price) that goes to the fundraiser, in
  // basis points (5000 = 50%). The rest is the winners' pool. Defaults to
  // DEFAULT_CHARITY_BPS.
  charityBps?: number;
  // How the winners' pool is divided across the configured periods, in
  // basis points of the winners' pool (must total 10000). Defaults to
  // DEFAULT_SPLIT_BPS[payoutStructure].
  splitBps?: Partial<Record<SquaresPeriod, number>>;
  // Manually entered score at the end of each period (top team = col, side
  // team = row). Winners are derived from these plus the drawn numbers.
  scores?: Partial<Record<SquaresPeriod, { col: number; row: number }>>;
};

export const PERIODS_BY_STRUCTURE: Record<PayoutStructure, SquaresPeriod[]> = {
  final_only: ["final"],
  half_final: ["half", "final"],
  quarters: ["q1", "half", "q3", "final"],
};

export const PERIOD_LABELS: Record<SquaresPeriod, string> = {
  q1: "End of 1st quarter",
  half: "Halftime",
  q3: "End of 3rd quarter",
  final: "Final (overtime included)",
};

export const PERIOD_SHORT_LABELS: Record<SquaresPeriod, string> = {
  q1: "Q1",
  half: "Half",
  q3: "Q3",
  final: "Final",
};

export const PAYOUT_STRUCTURE_OPTIONS: { value: PayoutStructure; label: string }[] = [
  { value: "final_only", label: "Final only" },
  { value: "half_final", label: "Halftime + Final" },
  { value: "quarters", label: "Every quarter + Final" },
];

export const DEFAULT_CHARITY_BPS = 5000;

// Weighted toward the final, as pools usually are: quarters pay 12.5% /
// 25% / 12.5% / 50% of the winners' pool. Halftime + Final keeps the same
// 1:2 ratio between half and final.
export const DEFAULT_SPLIT_BPS: Record<PayoutStructure, Partial<Record<SquaresPeriod, number>>> = {
  final_only: { final: 10000 },
  half_final: { half: 3333, final: 6667 },
  quarters: { q1: 1250, half: 2500, q3: 1250, final: 5000 },
};
