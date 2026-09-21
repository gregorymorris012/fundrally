"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SPLIT_BPS,
  PAYOUT_STRUCTURE_OPTIONS,
  PERIOD_LABELS,
  PERIODS_BY_STRUCTURE,
  type PayoutStructure,
  type SquaresPeriod,
} from "@/lib/squares-config";
import { computePayouts } from "@/lib/squares-rules";

function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

// basis points -> percent string for an input ("1250" -> "12.5")
function toPercent(bps: number) {
  return String(Number((bps / 100).toFixed(2)));
}

function defaultPercents(structure: PayoutStructure): Record<string, string> {
  const split = DEFAULT_SPLIT_BPS[structure];
  return Object.fromEntries(
    PERIODS_BY_STRUCTURE[structure].map((p) => [p, toPercent(split[p] ?? 0)]),
  );
}

// The organizer-facing payout editor. The live total and dollar amounts are
// a convenience so a bad split can't be saved by accident; updatePayoutRules
// re-validates on the server and is the actual check.
export function PayoutRulesForm({
  action,
  orgId,
  moduleId,
  orgSlug,
  fundraiserSlug,
  pricePerSquareCents,
  initial,
}: {
  action: (formData: FormData) => void | Promise<void>;
  orgId: string;
  moduleId: string;
  orgSlug: string;
  fundraiserSlug: string;
  pricePerSquareCents: number | null;
  initial: { structure: PayoutStructure; charityBps: number; splitBps: Partial<Record<SquaresPeriod, number>> };
}) {
  const [structure, setStructure] = useState<PayoutStructure>(initial.structure);
  const [charity, setCharity] = useState(toPercent(initial.charityBps));
  const [percents, setPercents] = useState<Record<string, string>>(
    Object.fromEntries(
      PERIODS_BY_STRUCTURE[initial.structure].map((p) => [p, toPercent(initial.splitBps[p] ?? 0)]),
    ),
  );

  const periods = PERIODS_BY_STRUCTURE[structure];
  const total = periods.reduce((sum, p) => sum + (Number(percents[p]) || 0), 0);
  const totalOk = Math.abs(total - 100) < 0.005;
  const charityNum = Number(charity);
  const charityOk = Number.isFinite(charityNum) && charityNum >= 0 && charityNum <= 100;

  // Same math the server uses, so the dollars shown here match what players see.
  const preview =
    pricePerSquareCents && totalOk && charityOk
      ? computePayouts({
          pricePerSquareCents,
          payoutStructure: structure,
          charityBps: Math.round(charityNum * 100),
          splitBps: Object.fromEntries(
            periods.map((p) => [p, Math.round((Number(percents[p]) || 0) * 100)]),
          ),
        })
      : null;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="moduleId" value={moduleId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Payout periods</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PAYOUT_STRUCTURE_OPTIONS.map((option) => {
            const selected = structure === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  "cursor-pointer rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/50",
                  selected && "border-selection ring-2 ring-selection ring-inset",
                )}
              >
                <input
                  type="radio"
                  name="payoutStructure"
                  value={option.value}
                  checked={selected}
                  onChange={() => {
                    setStructure(option.value);
                    setPercents(defaultPercents(option.value));
                  }}
                  className="sr-only"
                />
                {option.label}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          The numbers are drawn once and never change — each period simply pays the
          square they point to at that score. Switching resets the split below to
          that option&apos;s default.
        </p>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="charityPercent">Share of the pot that goes to the fundraiser (%)</Label>
        <div className="flex items-center gap-3">
          <Input
            id="charityPercent"
            name="charityPercent"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={charity}
            onChange={(e) => setCharity(e.target.value)}
            className="w-28"
          />
          <span className="text-sm text-muted-foreground">
            {preview
              ? `${dollars(preview.charityCents)} of ${dollars(preview.potCents)}`
              : pricePerSquareCents
                ? ""
                : "Set a price per square to see dollar amounts."}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          The rest{charityOk ? ` (${(100 - charityNum).toFixed(2).replace(/\.?0+$/, "")}%)` : ""} is
          the winners&apos; pool, divided across the periods below.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Winners&apos; pool split</p>
        {periods.map((period, i) => (
          <div key={period} className="flex items-center gap-3">
            <Label htmlFor={`pct_${period}`} className="w-52 shrink-0 font-normal">
              {PERIOD_LABELS[period]}
            </Label>
            <Input
              id={`pct_${period}`}
              name={`pct_${period}`}
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={percents[period] ?? ""}
              onChange={(e) => setPercents((prev) => ({ ...prev, [period]: e.target.value }))}
              className="w-28"
            />
            <span className="text-sm text-muted-foreground">
              % {preview ? `= ${dollars(preview.periods[i].cents)}` : ""}
            </span>
          </div>
        ))}
        <p className={cn("text-sm font-medium", totalOk ? "text-success" : "text-destructive")}>
          {totalOk
            ? "Total 100% ✓"
            : `Total ${Number(total.toFixed(2))}% — the periods must add up to 100% of the winners' pool.`}
        </p>
      </div>

      <Button type="submit" disabled={!totalOk || !charityOk}>
        Save payout rules
      </Button>
    </form>
  );
}
