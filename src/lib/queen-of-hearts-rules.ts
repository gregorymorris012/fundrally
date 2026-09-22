// Pure game logic for Queen of Hearts — no database, no Next.js, no
// randomness source of its own. Safe to import from server code, client
// components (for live previews), and tests alike, same split as
// squares-rules.ts.
//
// Every function that needs a random choice takes a `randomInt` parameter
// with NO default — unlike a typical reference implementation that
// defaults to Math.random(), there is deliberately no fallback here, so
// it's impossible to call shuffleDeck()/pickWeightedEntry() without
// explicitly supplying one. Build spec rule 1 (server-authoritative
// outcomes: crypto.randomInt, never Math.random) is enforced by
// construction, not by convention: only server code
// (src/lib/queen-of-hearts-draws.ts, "use server") ever calls these with
// a real random source (node:crypto's randomInt); tests supply a
// deterministic fake.
import {
  AGE_MINIMUM,
  BOARD_SIZE,
  DEFAULT_JACKPOT_PERCENT_IF_WINNER_ABSENT_BPS,
  DEFAULT_JACKPOT_SHARE_BPS,
  DEFAULT_PRIZE_TABLE,
  DEFAULT_TICKET_PRICE_CENTS,
  TAX_REPORTING_THRESHOLD_CENTS,
  type QohCard,
  type QohConfig,
  type QohPrizeTable,
  type QohPrizeTier,
  type Rank,
  type Suit,
} from "@/lib/queen-of-hearts-config";

export { AGE_MINIMUM, BOARD_SIZE, TAX_REPORTING_THRESHOLD_CENTS };

const BPS_TOTAL = 10_000;
const SUITS: Suit[] = ["Spades", "Hearts", "Diamonds", "Clubs"];
const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King", "Ace"];

/** A source of uniform random integers in [0, maxExclusive) — always crypto.randomInt in real use. */
export type RandomInt = (maxExclusive: number) => number;

/** The 54-card deck (52 standard cards + 2 Jokers), in a fixed, non-random order. */
export function buildDeck(): QohCard[] {
  const deck: QohCard[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ type: "standard", rank, suit, label: `${rank} of ${suit}` });
    }
  }
  deck.push({ type: "joker", rank: "Joker", suit: null, label: "Joker" });
  deck.push({ type: "joker", rank: "Joker", suit: null, label: "Joker" });
  return deck; // length 54
}

/** Fisher-Yates shuffle. Returns a new array; does not mutate the input. */
export function shuffle<T>(array: T[], randomInt: RandomInt): T[] {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Shuffle the deck and assign it to board positions 1-54. The one-time "board_shuffle" draw's result. */
export function shuffleBoard(randomInt: RandomInt): QohCard[] {
  return shuffle(buildDeck(), randomInt);
}

export function isQueenOfHearts(card: QohCard): boolean {
  return card.type === "standard" && card.rank === "Queen" && card.suit === "Hearts";
}

/** Which prize-table tier a card belongs to (Queen of Hearts itself has no tier — it's the jackpot). */
export function tierForCard(card: QohCard): QohPrizeTier | "queenOfHearts" {
  if (card.type === "joker") return "joker";
  if (card.rank === "Queen" && card.suit !== "Hearts") return "secondaryQueen";
  if (card.rank === "Queen" && card.suit === "Hearts") return "queenOfHearts";
  if (card.rank === "King" || card.rank === "Jack" || card.rank === "Ace") return "highFace";
  return "numbered";
}

export type ResolvedRules = {
  ticketPriceCents: number;
  jackpotShareBps: number; // of each entry's price
  jackpotPercentIfWinnerAbsentBps: number;
  prizeTable: QohPrizeTable;
};

/** Config with defaults filled in, and out-of-range basis-point values clamped. */
export function resolveRules(config: QohConfig): ResolvedRules {
  return {
    ticketPriceCents:
      config.ticketPriceCents && config.ticketPriceCents > 0
        ? Math.round(config.ticketPriceCents)
        : DEFAULT_TICKET_PRICE_CENTS,
    jackpotShareBps: clampBps(config.jackpotShareBps ?? DEFAULT_JACKPOT_SHARE_BPS),
    jackpotPercentIfWinnerAbsentBps: clampBps(
      config.jackpotPercentIfWinnerAbsentBps ?? DEFAULT_JACKPOT_PERCENT_IF_WINNER_ABSENT_BPS,
    ),
    prizeTable: { ...DEFAULT_PRIZE_TABLE, ...config.prizeTable },
  };
}

function clampBps(bps: number): number {
  if (!Number.isFinite(bps)) return 0;
  return Math.min(BPS_TOTAL, Math.max(0, Math.round(bps)));
}

/** Split one entry's (display) price between the jackpot and the fundraiser, per the configured share. */
export function splitEntryValue(
  rules: ResolvedRules,
  quantity: number,
): { grossCents: number; jackpotAddCents: number; fundraiserAddCents: number } {
  const grossCents = quantity * rules.ticketPriceCents;
  const jackpotAddCents = Math.floor((grossCents * rules.jackpotShareBps) / BPS_TOTAL);
  return { grossCents, jackpotAddCents, fundraiserAddCents: grossCents - jackpotAddCents };
}

export type QohEntry = {
  id: string;
  cycleNumber: number;
  displayName: string;
  cardNumber: number | null; // null = "day-of" — only picked live if this entry is drawn
  quantity: number;
};

/** This cycle's entries only, plus their weighted expansion (quantity 3 = 3 draw slots). */
export function cycleContestants(
  entries: QohEntry[],
  cycleNumber: number,
): { entries: QohEntry[]; weightedIds: string[] } {
  const cycleEntries = entries.filter((e) => e.cycleNumber === cycleNumber);
  const weightedIds: string[] = [];
  for (const entry of cycleEntries) {
    for (let i = 0; i < Math.max(1, entry.quantity); i++) weightedIds.push(entry.id);
  }
  return { entries: cycleEntries, weightedIds };
}

/** Pick one entry id, weighted by quantity — the "random name drawn" moment. */
export function pickWeightedEntry(weightedIds: string[], randomInt: RandomInt): string {
  if (weightedIds.length === 0) throw new Error("No entries to draw from.");
  return weightedIds[randomInt(weightedIds.length)];
}

/** A board number a new entry may pick: in range and not already claimed this cycle. */
export function validateCardNumberSelection(
  cardNumber: number | null | undefined,
  claimedThisCycle: Set<number>,
): void {
  if (cardNumber == null) return; // day-of entry
  if (!Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > BOARD_SIZE) {
    throw new Error(`Pick a number between 1 and ${BOARD_SIZE}.`);
  }
  if (claimedThisCycle.has(cardNumber)) {
    throw new Error(`Number ${cardNumber} is already taken this cycle — pick another.`);
  }
}

export type DrawOutcome = "JACKPOT" | "CONSOLATION";

export type ResolvedDraw = {
  cycleNumber: number;
  winningEntryId: string;
  revealedPosition: number; // 1-54
  card: QohCard;
  usedFallbackNumber: boolean; // the winner's chosen number was already revealed; the lowest still-open number was used instead
  outcome: DrawOutcome;
  tier?: QohPrizeTier; // CONSOLATION only
  prizeCents?: number; // CONSOLATION only
  jackpotAfterCents?: number; // CONSOLATION only — the jackpot carrying into the next cycle
  winnerPresent?: boolean; // JACKPOT only
  jackpotBeforeCents?: number; // JACKPOT only
  payoutCents?: number; // JACKPOT only
  carryOverCents?: number; // JACKPOT only — seeds the next game, if one is started
  requiresTaxForm: boolean;
};

/**
 * Resolve a drawing once the winning entry and its board number are both
 * known (immediately, if the entry picked a number in advance; after a
 * live pick, if it was "day-of"). No randomness here — the draw already
 * happened; this is pure derivation, safe to preview or re-render.
 */
export function resolveDraw(input: {
  cycleNumber: number;
  winningEntryId: string;
  cardNumber: number; // the winner's chosen (or live-picked) number
  board: QohCard[]; // index 0 = position 1, ..., index 53 = position 54
  revealedPositions: Set<number>; // positions already permanently revealed in prior cycles
  rules: ResolvedRules;
  jackpotBeforeCents: number;
  winnerPresent?: boolean; // only relevant if the revealed card is the Queen of Hearts; defaults true
}): ResolvedDraw {
  let position = input.cardNumber;
  let usedFallbackNumber = false;
  if (input.revealedPositions.has(position)) {
    const open = [];
    for (let n = 1; n <= BOARD_SIZE; n++) if (!input.revealedPositions.has(n)) open.push(n);
    if (open.length === 0) throw new Error("Every position has already been revealed.");
    position = Math.min(...open);
    usedFallbackNumber = true;
  }
  const card = input.board[position - 1];
  if (!card) throw new Error(`No card assigned to position ${position} — has the board been shuffled?`);

  if (isQueenOfHearts(card)) {
    const winnerPresent = input.winnerPresent !== false;
    const payoutPercent = winnerPresent ? BPS_TOTAL : input.rules.jackpotPercentIfWinnerAbsentBps;
    const payoutCents = Math.round((input.jackpotBeforeCents * payoutPercent) / BPS_TOTAL);
    const carryOverCents = input.jackpotBeforeCents - payoutCents;
    return {
      cycleNumber: input.cycleNumber,
      winningEntryId: input.winningEntryId,
      revealedPosition: position,
      card,
      usedFallbackNumber,
      outcome: "JACKPOT",
      winnerPresent,
      jackpotBeforeCents: input.jackpotBeforeCents,
      payoutCents,
      carryOverCents,
      requiresTaxForm: payoutCents >= TAX_REPORTING_THRESHOLD_CENTS,
    };
  }

  const tier = tierForCard(card) as QohPrizeTier;
  const prizeCents = input.rules.prizeTable[tier] ?? 0;
  return {
    cycleNumber: input.cycleNumber,
    winningEntryId: input.winningEntryId,
    revealedPosition: position,
    card,
    usedFallbackNumber,
    outcome: "CONSOLATION",
    tier,
    prizeCents,
    jackpotAfterCents: input.jackpotBeforeCents, // consolation prizes don't reduce the jackpot
    requiresTaxForm: prizeCents >= TAX_REPORTING_THRESHOLD_CENTS,
  };
}

export type JackpotTotals = {
  jackpotCents: number; // current jackpot, all cycles to date
  fundraiserShareCents: number; // display total that would go straight to the fundraiser
  potCents: number; // jackpotCents + fundraiserShareCents (excluding the seed)
};

/**
 * The running jackpot/fundraiser totals, derived from every entry sold so
 * far this game (all cycles) — never stored as mutable state, same
 * philosophy as squares' payouts being computed from config + entries
 * rather than a running balance that could drift out of sync.
 */
export function computeJackpotTotals(
  rules: ResolvedRules,
  entries: QohEntry[],
  seedCents = 0,
): JackpotTotals {
  let jackpotCents = seedCents;
  let fundraiserShareCents = 0;
  for (const entry of entries) {
    const { jackpotAddCents, fundraiserAddCents } = splitEntryValue(rules, entry.quantity);
    jackpotCents += jackpotAddCents;
    fundraiserShareCents += fundraiserAddCents;
  }
  return { jackpotCents, fundraiserShareCents, potCents: jackpotCents + fundraiserShareCents };
}

export function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
