import { describe, expect, it } from "vitest";
import { BOARD_SIZE } from "@/lib/queen-of-hearts-config";
import {
  buildDeck,
  computeJackpotTotals,
  cycleContestants,
  isQueenOfHearts,
  pickWeightedEntry,
  resolveDraw,
  resolveRules,
  shuffle,
  shuffleBoard,
  splitEntryValue,
  tierForCard,
  validateCardNumberSelection,
  type QohEntry,
} from "@/lib/queen-of-hearts-rules";

// A tiny counting fake in place of crypto.randomInt — deterministic and
// cycles through 0, 1, 2, ... so tests never depend on real randomness.
function countingRandomInt() {
  let n = 0;
  return (maxExclusive: number) => {
    const v = n % maxExclusive;
    n++;
    return v;
  };
}

describe("buildDeck", () => {
  it("builds 52 standard cards + 2 jokers with no duplicates", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(BOARD_SIZE);
    const jokers = deck.filter((c) => c.type === "joker");
    expect(jokers).toHaveLength(2);
    const standard = deck.filter((c) => c.type === "standard");
    expect(standard).toHaveLength(52);
    const labels = new Set(standard.map((c) => c.label));
    expect(labels.size).toBe(52); // every standard card is unique
    expect(deck.some(isQueenOfHearts)).toBe(true);
  });

  it("is deterministic — no randomness in building the raw deck", () => {
    expect(buildDeck()).toEqual(buildDeck());
  });
});

describe("shuffle / shuffleBoard", () => {
  it("returns a permutation of the input, without mutating it", () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input, countingRandomInt());
    expect(input).toEqual([1, 2, 3, 4, 5]); // unmutated
    expect([...result].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("shuffleBoard assigns every one of the 54 cards to exactly one position", () => {
    const board = shuffleBoard(countingRandomInt());
    expect(board).toHaveLength(BOARD_SIZE);
    // Same multiset as the built deck (the two Jokers share a label, so
    // this checks card identity by sorted rank+suit pairs, not Set-of-labels).
    const key = (c: (typeof board)[number]) => `${c.rank}:${c.suit ?? ""}`;
    expect(board.map(key).sort()).toEqual(buildDeck().map(key).sort());
    expect(board.filter(isQueenOfHearts)).toHaveLength(1);
  });
});

describe("tierForCard / isQueenOfHearts", () => {
  it("classifies the Queen of Hearts on its own, not as secondaryQueen", () => {
    const qoh = { type: "standard" as const, rank: "Queen" as const, suit: "Hearts" as const, label: "Queen of Hearts" };
    expect(isQueenOfHearts(qoh)).toBe(true);
    expect(tierForCard(qoh)).toBe("queenOfHearts");
  });

  it("classifies every other tier correctly", () => {
    const card = (rank: string, suit: string) =>
      ({ type: "standard" as const, rank: rank as never, suit: suit as never, label: `${rank} of ${suit}` });
    expect(tierForCard(card("Queen", "Spades"))).toBe("secondaryQueen");
    expect(tierForCard(card("King", "Clubs"))).toBe("highFace");
    expect(tierForCard(card("Jack", "Diamonds"))).toBe("highFace");
    expect(tierForCard(card("Ace", "Hearts"))).toBe("highFace");
    expect(tierForCard(card("7", "Spades"))).toBe("numbered");
    expect(tierForCard({ type: "joker", rank: "Joker", suit: null, label: "Joker" })).toBe("joker");
  });
});

describe("resolveRules", () => {
  it("defaults ticket price, jackpot share, and prize table when unset", () => {
    const rules = resolveRules({});
    expect(rules.ticketPriceCents).toBe(500);
    expect(rules.jackpotShareBps).toBe(5500);
    expect(rules.prizeTable.numbered).toBe(1000);
  });

  it("clamps out-of-range basis-point values", () => {
    expect(resolveRules({ jackpotShareBps: 99_999 }).jackpotShareBps).toBe(10_000);
    expect(resolveRules({ jackpotShareBps: -1 }).jackpotShareBps).toBe(0);
  });

  it("merges a partial prize table over the defaults", () => {
    const rules = resolveRules({ prizeTable: { joker: 25_000 } });
    expect(rules.prizeTable.joker).toBe(25_000);
    expect(rules.prizeTable.numbered).toBe(1000); // untouched default
  });
});

describe("splitEntryValue", () => {
  it("splits a $5 entry 55/45 by default", () => {
    const rules = resolveRules({});
    expect(splitEntryValue(rules, 1)).toEqual({ grossCents: 500, jackpotAddCents: 275, fundraiserAddCents: 225 });
  });

  it("scales with quantity", () => {
    const rules = resolveRules({ ticketPriceCents: 500, jackpotShareBps: 5000 });
    expect(splitEntryValue(rules, 4)).toEqual({ grossCents: 2000, jackpotAddCents: 1000, fundraiserAddCents: 1000 });
  });
});

describe("cycleContestants / pickWeightedEntry", () => {
  const entries: QohEntry[] = [
    { id: "a", cycleNumber: 1, displayName: "Ana", cardNumber: 3, quantity: 1 },
    { id: "b", cycleNumber: 1, displayName: "Ben", cardNumber: null, quantity: 3 },
    { id: "c", cycleNumber: 2, displayName: "Cal", cardNumber: 9, quantity: 1 }, // different cycle
  ];

  it("expands entries by quantity, scoped to the requested cycle", () => {
    const { entries: cycleEntries, weightedIds } = cycleContestants(entries, 1);
    expect(cycleEntries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(weightedIds).toEqual(["a", "b", "b", "b"]); // Ben's 3 entries weight the draw
  });

  it("picks only from the weighted pool", () => {
    const { weightedIds } = cycleContestants(entries, 1);
    const picked = pickWeightedEntry(weightedIds, countingRandomInt());
    expect(weightedIds).toContain(picked);
  });

  it("throws when there are no entries to draw from", () => {
    expect(() => pickWeightedEntry([], countingRandomInt())).toThrow(/no entries/i);
  });
});

describe("validateCardNumberSelection", () => {
  it("allows a day-of (null) selection unconditionally", () => {
    expect(() => validateCardNumberSelection(null, new Set([1, 2]))).not.toThrow();
  });

  it("rejects an out-of-range number", () => {
    expect(() => validateCardNumberSelection(0, new Set())).toThrow(/between 1 and 54/);
    expect(() => validateCardNumberSelection(55, new Set())).toThrow(/between 1 and 54/);
  });

  it("rejects a number already claimed this cycle", () => {
    expect(() => validateCardNumberSelection(5, new Set([5]))).toThrow(/already taken/i);
  });

  it("accepts an in-range, unclaimed number", () => {
    expect(() => validateCardNumberSelection(5, new Set([6]))).not.toThrow();
  });
});

describe("resolveDraw", () => {
  const rules = resolveRules({ prizeTable: { numbered: 1000, highFace: 2500, secondaryQueen: 5000, joker: 10000 } });
  // Board: position 1 = Queen of Hearts, position 2 = 7 of Spades, rest arbitrary standard cards.
  const board = buildDeck();
  const qohIndex = board.findIndex(isQueenOfHearts);
  [board[0], board[qohIndex]] = [board[qohIndex], board[0]];
  const sevenIndex = board.findIndex((c) => c.type === "standard" && c.rank === "7" && c.suit === "Spades");
  [board[1], board[sevenIndex]] = [board[sevenIndex], board[1]];

  it("pays a consolation prize and rolls the jackpot forward on a non-Queen reveal", () => {
    const result = resolveDraw({
      cycleNumber: 1,
      winningEntryId: "e1",
      cardNumber: 2,
      board,
      revealedPositions: new Set(),
      rules,
      jackpotBeforeCents: 50_000,
    });
    expect(result).toMatchObject({
      outcome: "CONSOLATION",
      revealedPosition: 2,
      tier: "numbered",
      prizeCents: 1000,
      jackpotAfterCents: 50_000,
      usedFallbackNumber: false,
      requiresTaxForm: false,
    });
  });

  it("pays the full jackpot and ends the game when the Queen of Hearts is revealed with the winner present", () => {
    const result = resolveDraw({
      cycleNumber: 4,
      winningEntryId: "e2",
      cardNumber: 1,
      board,
      revealedPositions: new Set([2, 3, 4]),
      rules,
      jackpotBeforeCents: 120_000,
    });
    expect(result).toMatchObject({
      outcome: "JACKPOT",
      revealedPosition: 1,
      winnerPresent: true,
      jackpotBeforeCents: 120_000,
      payoutCents: 120_000,
      carryOverCents: 0,
      requiresTaxForm: true, // >= $600
    });
  });

  it("pays only the configured percent, carrying the rest over, when the winner isn't present", () => {
    const result = resolveDraw({
      cycleNumber: 4,
      winningEntryId: "e2",
      cardNumber: 1,
      board,
      revealedPositions: new Set(),
      rules,
      jackpotBeforeCents: 100_000,
      winnerPresent: false,
    });
    expect(result.payoutCents).toBe(50_000); // default 50% if absent
    expect(result.carryOverCents).toBe(50_000);
  });

  it("falls back to the lowest still-open number if the chosen one is already revealed", () => {
    const result = resolveDraw({
      cycleNumber: 2,
      winningEntryId: "e3",
      cardNumber: 2, // already revealed
      board,
      revealedPositions: new Set([2, 3]),
      rules,
      jackpotBeforeCents: 10_000,
    });
    expect(result.usedFallbackNumber).toBe(true);
    expect(result.revealedPosition).toBe(1); // lowest open, in this fixture — but 1 is the Queen
    expect(result.outcome).toBe("JACKPOT");
  });

  it("throws once every position has been revealed", () => {
    const allRevealed = new Set(Array.from({ length: 54 }, (_, i) => i + 1));
    expect(() =>
      resolveDraw({
        cycleNumber: 5,
        winningEntryId: "e4",
        cardNumber: 1,
        board,
        revealedPositions: allRevealed,
        rules,
        jackpotBeforeCents: 1000,
      }),
    ).toThrow(/every position/i);
  });
});

describe("computeJackpotTotals", () => {
  it("derives jackpot and fundraiser totals from entries, never stored state", () => {
    const rules = resolveRules({ ticketPriceCents: 500, jackpotShareBps: 5000 });
    const entries: QohEntry[] = [
      { id: "a", cycleNumber: 1, displayName: "Ana", cardNumber: 1, quantity: 2 },
      { id: "b", cycleNumber: 2, displayName: "Ben", cardNumber: 1, quantity: 1 }, // counts across all cycles
    ];
    const totals = computeJackpotTotals(rules, entries, 10_000 /* seed */);
    // gross = (2+1) * 500 = 1500; 50/50 split = 750/750; + 10,000 seed
    expect(totals).toEqual({ jackpotCents: 10_750, fundraiserShareCents: 750, potCents: 11_500 });
  });

  it("is exactly the seed when there are no entries yet", () => {
    const totals = computeJackpotTotals(resolveRules({}), [], 5000);
    expect(totals).toEqual({ jackpotCents: 5000, fundraiserShareCents: 0, potCents: 5000 });
  });
});
