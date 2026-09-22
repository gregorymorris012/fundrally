// Queen of Hearts-only shape of modules.config — same reasoning as
// squares-config.ts: this lives outside src/lib/queen-of-hearts.ts
// because that file is "use server", and Next.js requires every export
// from a "use server" file to be an async function, which plain
// types/constants aren't.
//
// A board has 54 positions, secretly matched (once, at setup) to a
// standard 52-card deck plus 2 Jokers. Supporters "enter" for the current
// weekly cycle, optionally picking a board number in advance; a weekly
// drawing reveals one position. Any card but the Queen of Hearts pays a
// fixed consolation prize and the game rolls into the next cycle; the
// Queen of Hearts pays the jackpot and ends the game.
//
// Demo mode only, same as every other chance module (CLAUDE.md's active
// deviation): entries are free, no checkout exists. ticketPriceCents and
// the revenue split below are display/bookkeeping inputs only — they
// size the jackpot and prize amounts shown to players, exactly like
// squares' pricePerSquareCents. Real dollars collected in person reach
// the ledger only through offline gift entry, tagged to the module.

export type Suit = "Spades" | "Hearts" | "Diamonds" | "Clubs";
export type Rank =
  | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10"
  | "Jack" | "Queen" | "King" | "Ace";

export interface StandardCard {
  type: "standard";
  rank: Rank;
  suit: Suit;
  label: string; // e.g. "Queen of Hearts"
}

export interface JokerCard {
  type: "joker";
  rank: "Joker";
  suit: null;
  label: "Joker";
}

export type QohCard = StandardCard | JokerCard;

/** Which prize-table tier a non-Queen-of-Hearts card falls into. */
export type QohPrizeTier = "joker" | "secondaryQueen" | "highFace" | "numbered";

export interface QohPrizeTable {
  joker: number; // cents — both Jokers (2 cards)
  secondaryQueen: number; // cents — Queen of Spades/Clubs/Diamonds (3 cards)
  highFace: number; // cents — Kings, Jacks, Aces (12 cards)
  numbered: number; // cents — 2 through 10 (36 cards)
}

export const BOARD_SIZE = 54; // 52 cards + 2 Jokers

export const DEFAULT_TICKET_PRICE_CENTS = 500; // $5.00/entry
export const DEFAULT_JACKPOT_SHARE_BPS = 5500; // 55% of each entry feeds the jackpot; rest is the fundraiser's
export const DEFAULT_JACKPOT_PERCENT_IF_WINNER_ABSENT_BPS = 5000; // 50%, if the Queen's number wasn't claimed by anyone
export const DEFAULT_PRIZE_TABLE: QohPrizeTable = {
  joker: 10000, // $100
  secondaryQueen: 5000, // $50
  highFace: 2500, // $25
  numbered: 1000, // $10
};

/** Fixed platform minimum for the self-attestation checkbox, not organizer-configurable. */
export const AGE_MINIMUM = 18;

/** IRS reference threshold — informational display only, no tax forms are generated. */
export const TAX_REPORTING_THRESHOLD_CENTS = 60000; // $600

export type QohConfig = {
  ticketPriceCents?: number;
  // Basis points (5500 = 55%) of each entry's price that feeds the
  // jackpot; the rest is shown as going straight to the fundraiser.
  jackpotShareBps?: number;
  prizeTable?: Partial<QohPrizeTable>;
  // Basis points of the jackpot paid out if the Queen's number was never
  // claimed by an entry (the rest carries into the next game's seed).
  jackpotPercentIfWinnerAbsentBps?: number;
  jackpotSeedCents?: number;
  // Self-attestation checkboxes the organizer confirms at setup — not a
  // permit/ID check, just a recorded confirmation (CLAUDE.md: real
  // compliance tracking is Phase 4's compliance_records, not this).
  organizerConfirmedCompliance?: boolean;
  organizerConfirmedComplianceAt?: string; // ISO timestamp
  showBoardNumbers?: boolean; // visual 1-54 label on each position; defaults to on
};
