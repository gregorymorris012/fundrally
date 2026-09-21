// Pure rules/payout math for squares pools — no I/O, safe to import from
// server code, client components, and tests alike. Amounts are display and
// bookkeeping only: FundRally never holds or moves prize money (payouts to
// winners are settled by the organizer offline), and chance modules stay
// demo-mode until Phase 4's compliance work regardless of what this shows.
import {
  DEFAULT_CHARITY_BPS,
  DEFAULT_SPLIT_BPS,
  PERIODS_BY_STRUCTURE,
  type PayoutStructure,
  type SquaresConfig,
  type SquaresPeriod,
} from "@/lib/squares-config";

export const GRID_SIZE = 10;
export const SQUARE_COUNT = GRID_SIZE * GRID_SIZE;
const BPS_TOTAL = 10_000;

export type ResolvedRules = {
  structure: PayoutStructure;
  periods: SquaresPeriod[];
  charityBps: number;
  // Only the configured periods, always totalling BPS_TOTAL.
  splitBps: Partial<Record<SquaresPeriod, number>>;
};

// Config with defaults filled in. A stored split that doesn't match the
// configured periods (e.g. structure changed) or doesn't total 100% falls
// back to that structure's defaults rather than paying out nonsense.
export function resolveRules(config: SquaresConfig): ResolvedRules {
  const structure = config.payoutStructure ?? "final_only";
  const periods = PERIODS_BY_STRUCTURE[structure];
  const charityBps = clampBps(config.charityBps ?? DEFAULT_CHARITY_BPS);
  const stored = config.splitBps;
  const storedValid =
    !!stored &&
    Object.keys(stored).every((k) => periods.includes(k as SquaresPeriod)) &&
    periods.every((p) => Number.isInteger(stored[p]) && (stored[p] as number) >= 0) &&
    periods.reduce((sum, p) => sum + (stored[p] as number), 0) === BPS_TOTAL;
  return {
    structure,
    periods,
    charityBps,
    splitBps: storedValid ? (stored as Partial<Record<SquaresPeriod, number>>) : DEFAULT_SPLIT_BPS[structure],
  };
}

function clampBps(bps: number): number {
  if (!Number.isFinite(bps)) return DEFAULT_CHARITY_BPS;
  return Math.min(BPS_TOTAL, Math.max(0, Math.round(bps)));
}

export type Payouts = {
  potCents: number;
  charityCents: number;
  winnersPoolCents: number;
  // One entry per configured period, in play order. Rounding leftovers go
  // to the final so the periods always sum to exactly the winners' pool.
  periods: { period: SquaresPeriod; bps: number; cents: number }[];
};

// Null until a price is set — there's no pot to divide yet.
export function computePayouts(config: SquaresConfig): Payouts | null {
  const price = config.pricePerSquareCents;
  if (!price || price <= 0) return null;
  const rules = resolveRules(config);
  const potCents = price * SQUARE_COUNT;
  const charityCents = Math.floor((potCents * rules.charityBps) / BPS_TOTAL);
  const winnersPoolCents = potCents - charityCents;

  const periods = rules.periods.map((period) => {
    const bps = rules.splitBps[period] ?? 0;
    return { period, bps, cents: Math.floor((winnersPoolCents * bps) / BPS_TOTAL) };
  });
  const leftover = winnersPoolCents - periods.reduce((sum, p) => sum + p.cents, 0);
  periods[periods.length - 1].cents += leftover;
  return { potCents, charityCents, winnersPoolCents, periods };
}

// Checks a proposed split: whole basis points, only the structure's
// periods, totalling exactly 100% of the winners' pool.
export function validateSplit(
  structure: PayoutStructure,
  splitBps: Partial<Record<SquaresPeriod, number>>,
): string | null {
  const periods = PERIODS_BY_STRUCTURE[structure];
  let total = 0;
  for (const period of periods) {
    const bps = splitBps[period];
    if (bps == null || !Number.isInteger(bps) || bps < 0) {
      return "Each period needs a percentage of 0 or more.";
    }
    total += bps;
  }
  if (total !== BPS_TOTAL) {
    return `The period shares must total 100% of the winners' pool (currently ${(total / 100).toFixed(2).replace(/\.?0+$/, "")}%).`;
  }
  return null;
}

// The winning square (0-99) for a score: the top team's last digit picks
// the column and the side team's last digit picks the row, looked up in
// the drawn axis digits. Null if the numbers aren't drawn or malformed.
export function winningPosition(
  draw: { rowDigits: number[]; colDigits: number[] } | undefined,
  score: { col: number; row: number },
): number | null {
  if (!draw) return null;
  const col = draw.colDigits.indexOf(((score.col % 10) + 10) % 10);
  const row = draw.rowDigits.indexOf(((score.row % 10) + 10) % 10);
  if (col < 0 || row < 0) return null;
  return row * GRID_SIZE + col;
}

export type PeriodWinner = {
  period: SquaresPeriod;
  score: { col: number; row: number };
  position: number | null; // null if the numbers aren't drawn
  holder: string | null; // null if nobody holds that square
  prizeCents: number | null; // null until a price is set
};

// Winners for every period that has a score entered, in play order.
// holders maps square position -> the name that claimed it.
export function deriveWinners(
  config: SquaresConfig,
  draw: { rowDigits: number[]; colDigits: number[] } | undefined,
  holders: Map<number, string>,
): PeriodWinner[] {
  const rules = resolveRules(config);
  const payouts = computePayouts(config);
  const winners: PeriodWinner[] = [];
  for (const period of rules.periods) {
    const score = config.scores?.[period];
    if (!score) continue;
    const position = winningPosition(draw, score);
    winners.push({
      period,
      score,
      position,
      holder: position == null ? null : (holders.get(position) ?? null),
      prizeCents: payouts?.periods.find((p) => p.period === period)?.cents ?? null,
    });
  }
  return winners;
}
