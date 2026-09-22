"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { QohConfig, QohPrizeTable } from "@/lib/queen-of-hearts-config";
import { computeJackpotTotals, resolveRules } from "@/lib/queen-of-hearts-rules";

function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
function toDollarsInput(cents: number) {
  return (cents / 100).toFixed(2);
}
function toPercent(bps: number) {
  return String(Number((bps / 100).toFixed(2)));
}

const PRIZE_TIERS: { key: keyof QohPrizeTable; label: string; hint: string }[] = [
  { key: "joker", label: "Joker", hint: "both Jokers — 2 cards" },
  { key: "secondaryQueen", label: "Other Queen", hint: "♠ ♣ ♦ — 3 cards" },
  { key: "highFace", label: "King / Jack / Ace", hint: "12 cards" },
  { key: "numbered", label: "Numbered (2–10)", hint: "36 cards" },
];

// The organizer-facing settings form: ticket price, jackpot/fundraiser
// split, the consolation prize table, an optional jackpot seed, and the
// compliance self-attestation the board can't be shuffled without. The
// live dollar preview is a convenience, computed with the same
// computeJackpotTotals math the server uses — updateQueenOfHeartsRules
// re-validates on save; this is not the enforcement.
export function QohRulesForm({
  action,
  orgId,
  moduleId,
  orgSlug,
  fundraiserSlug,
  entryCount,
  initial,
}: {
  action: (formData: FormData) => void | Promise<void>;
  orgId: string;
  moduleId: string;
  orgSlug: string;
  fundraiserSlug: string;
  entryCount: number; // rough preview only — real total also depends on each entry's own quantity
  initial: QohConfig;
}) {
  const rules = resolveRules(initial);
  const [price, setPrice] = useState(toDollarsInput(rules.ticketPriceCents));
  const [jackpotShare, setJackpotShare] = useState(toPercent(rules.jackpotShareBps));
  const [absentShare, setAbsentShare] = useState(toPercent(rules.jackpotPercentIfWinnerAbsentBps));
  const [seed, setSeed] = useState(toDollarsInput(initial.jackpotSeedCents ?? 0));
  const [prizes, setPrizes] = useState<Record<string, string>>(
    Object.fromEntries(PRIZE_TIERS.map((t) => [t.key, toDollarsInput(rules.prizeTable[t.key])])),
  );
  const [compliance, setCompliance] = useState(initial.organizerConfirmedCompliance === true);

  const priceCents = Math.round((Number(price) || 0) * 100);
  const preview =
    priceCents > 0
      ? computeJackpotTotals(
          { ...rules, ticketPriceCents: priceCents, jackpotShareBps: Math.round((Number(jackpotShare) || 0) * 100) },
          // A rough stand-in: entryCount entries at quantity 1 each. The real
          // total also reflects each entry's own quantity, which this
          // preview can't know ahead of time.
          Array.from({ length: entryCount }, (_, i) => ({
            id: String(i),
            cycleNumber: 1,
            displayName: "",
            cardNumber: null,
            quantity: 1,
          })),
          Math.round((Number(seed) || 0) * 100),
        )
      : null;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="moduleId" value={moduleId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="qoh-ticket-price">Price per entry (USD)</Label>
          <Input
            id="qoh-ticket-price"
            name="ticketPrice"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qoh-jackpot-seed">Starting jackpot (USD, optional)</Label>
          <Input
            id="qoh-jackpot-seed"
            name="jackpotSeed"
            type="number"
            min="0"
            step="0.01"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="qoh-jackpot-share">Share of each entry that feeds the jackpot (%)</Label>
          <Input
            id="qoh-jackpot-share"
            name="jackpotSharePercent"
            type="number"
            min="0"
            max="100"
            step="0.01"
            required
            value={jackpotShare}
            onChange={(e) => setJackpotShare(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The rest goes straight to the fundraiser as each entry comes in.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qoh-absent-share">Jackpot paid if the winning number wasn&apos;t claimed (%)</Label>
          <Input
            id="qoh-absent-share"
            name="jackpotPercentIfWinnerAbsent"
            type="number"
            min="0"
            max="100"
            step="0.01"
            required
            value={absentShare}
            onChange={(e) => setAbsentShare(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">The remainder seeds the next game.</p>
        </div>
      </div>

      {preview && (
        <p className="text-sm text-muted-foreground">
          At roughly {entryCount} {entryCount === 1 ? "entry" : "entries"} so far: jackpot{" "}
          <span className="font-medium text-foreground">{dollars(preview.jackpotCents)}</span>, fundraiser{" "}
          <span className="font-medium text-foreground">{dollars(preview.fundraiserShareCents)}</span>.
        </p>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Consolation prizes</p>
        {PRIZE_TIERS.map((tier) => (
          <div key={tier.key} className="flex items-center gap-3">
            <Label htmlFor={`prize_${tier.key}`} className="w-44 shrink-0 font-normal">
              {tier.label}
              <span className="block text-xs text-muted-foreground">{tier.hint}</span>
            </Label>
            <Input
              id={`prize_${tier.key}`}
              name={`prize_${tier.key}`}
              type="number"
              min="0"
              step="0.01"
              required
              value={prizes[tier.key]}
              onChange={(e) => setPrizes((prev) => ({ ...prev, [tier.key]: e.target.value }))}
              className="w-28"
            />
          </div>
        ))}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="organizerConfirmedCompliance"
          checked={compliance}
          onChange={(e) => setCompliance(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--selection)]"
        />
        <span>
          I&apos;ve handled any charitable-gaming permit or registration this jurisdiction requires.
          <span className="block text-xs text-muted-foreground">
            FundRally helps run the fundraiser — it doesn&apos;t obtain permits. This is required before the board can
            be shuffled.
          </span>
        </span>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="showBoardNumbers"
          defaultChecked={initial.showBoardNumbers !== false}
          className="h-4 w-4 accent-[var(--selection)]"
        />
        Number each board position (1–54)
      </label>

      <Button type="submit">Save rules</Button>
    </form>
  );
}
