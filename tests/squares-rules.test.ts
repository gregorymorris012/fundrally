import { describe, expect, it } from "vitest";
import { computePayouts, resolveRules, validateSplit, winningPosition } from "@/lib/squares-rules";

describe("computePayouts", () => {
  it("returns null until a price is set", () => {
    expect(computePayouts({})).toBeNull();
    expect(computePayouts({ pricePerSquareCents: 0 })).toBeNull();
  });

  it("splits a $100 x 100 pot 50% to the fundraiser and 12.5/25/12.5/50 across quarters", () => {
    const payouts = computePayouts({ pricePerSquareCents: 10_000, payoutStructure: "quarters" });
    expect(payouts).toEqual({
      potCents: 1_000_000,
      charityCents: 500_000,
      winnersPoolCents: 500_000,
      periods: [
        { period: "q1", bps: 1250, cents: 62_500 },
        { period: "half", bps: 2500, cents: 125_000 },
        { period: "q3", bps: 1250, cents: 62_500 },
        { period: "final", bps: 5000, cents: 250_000 },
      ],
    });
  });

  it("pays the whole winners' pool to the final for final_only", () => {
    const payouts = computePayouts({ pricePerSquareCents: 500, payoutStructure: "final_only" });
    expect(payouts?.periods).toEqual([{ period: "final", bps: 10_000, cents: 25_000 }]);
  });

  it("always distributes exactly the winners' pool, even with awkward prices", () => {
    for (const price of [1, 33, 125, 777, 1999]) {
      for (const structure of ["final_only", "half_final", "quarters"] as const) {
        for (const charityBps of [0, 3333, 5000, 9999]) {
          const payouts = computePayouts({
            pricePerSquareCents: price,
            payoutStructure: structure,
            charityBps,
          });
          const paid = payouts!.periods.reduce((sum, p) => sum + p.cents, 0);
          expect(paid).toBe(payouts!.winnersPoolCents);
          expect(payouts!.charityCents + payouts!.winnersPoolCents).toBe(payouts!.potCents);
        }
      }
    }
  });

  it("honors a custom split, such as Q1 = $0", () => {
    const payouts = computePayouts({
      pricePerSquareCents: 10_000,
      payoutStructure: "quarters",
      splitBps: { q1: 0, half: 5000, q3: 0, final: 5000 },
    });
    expect(payouts?.periods.map((p) => p.cents)).toEqual([0, 250_000, 0, 250_000]);
  });
});

describe("resolveRules", () => {
  it("falls back to the structure's defaults when the stored split is stale or doesn't total 100%", () => {
    // Stored for quarters, but the pool is now Halftime + Final.
    const stale = resolveRules({
      payoutStructure: "half_final",
      splitBps: { q1: 2500, half: 2500, q3: 2500, final: 2500 },
    });
    expect(stale.splitBps).toEqual({ half: 3333, final: 6667 });

    const short = resolveRules({ payoutStructure: "quarters", splitBps: { q1: 1000, half: 1000, q3: 1000, final: 1000 } });
    expect(short.splitBps).toEqual({ q1: 1250, half: 2500, q3: 1250, final: 5000 });
  });

  it("defaults to a 50% fundraiser share and clamps out-of-range values", () => {
    expect(resolveRules({}).charityBps).toBe(5000);
    expect(resolveRules({ charityBps: 20_000 }).charityBps).toBe(10_000);
    expect(resolveRules({ charityBps: -5 }).charityBps).toBe(0);
  });
});

describe("validateSplit", () => {
  it("accepts a split that totals exactly 100%", () => {
    expect(validateSplit("quarters", { q1: 0, half: 5000, q3: 0, final: 5000 })).toBeNull();
  });

  it("rejects a split that doesn't total 100%", () => {
    expect(validateSplit("quarters", { q1: 1000, half: 1000, q3: 1000, final: 1000 })).toMatch(/total 100%/);
  });

  it("rejects a missing or negative period", () => {
    expect(validateSplit("half_final", { half: 5000 })).toMatch(/each period/i);
    expect(validateSplit("half_final", { half: -100, final: 10_100 })).toMatch(/each period/i);
  });
});

describe("winningPosition", () => {
  const draw = {
    colDigits: [3, 1, 4, 0, 5, 9, 2, 6, 8, 7],
    rowDigits: [7, 2, 8, 0, 5, 3, 1, 9, 4, 6],
  };

  it("finds the square where the top team's digit (column) meets the side team's digit (row)", () => {
    // col score 17 -> digit 7 -> column index 9; row score 24 -> digit 4 -> row index 8.
    expect(winningPosition(draw, { col: 17, row: 24 })).toBe(8 * 10 + 9);
    // 0-0 -> column index 3, row index 3.
    expect(winningPosition(draw, { col: 0, row: 0 })).toBe(3 * 10 + 3);
  });

  it("uses only the last digit of the score", () => {
    expect(winningPosition(draw, { col: 100, row: 100 })).toBe(winningPosition(draw, { col: 0, row: 0 }));
  });

  it("is null before the numbers are drawn", () => {
    expect(winningPosition(undefined, { col: 7, row: 3 })).toBeNull();
  });
});
