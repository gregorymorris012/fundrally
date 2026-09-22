import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { QohConfig } from "@/lib/queen-of-hearts-config";
import { AGE_MINIMUM, computeJackpotTotals, currentCycleNumber, resolveRules, type QohEntry, type WeeklyDrawSummary } from "@/lib/queen-of-hearts-rules";

function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
function percent(bps: number) {
  return `${Number((bps / 100).toFixed(2))}%`;
}

// The pool's rules and current jackpot, generated from its settings and
// entries so what players read can't drift from what the organizer
// configured — same reasoning as squares' RulesAndPayouts. Reusable by
// the admin Rules tab now and the public page once it exists.
export function QohInfo({
  config,
  entries,
  weeklyDraws,
}: {
  config: QohConfig;
  entries: QohEntry[];
  weeklyDraws: WeeklyDrawSummary[];
}) {
  const rules = resolveRules(config);
  const totals = computeJackpotTotals(rules, entries, config.jackpotSeedCents ?? 0);
  const cycle = currentCycleNumber(weeklyDraws);

  const steps = [
    {
      title: "Enter for this cycle",
      body: `Pick an open number (1–${54}) or ask for a "day-of" entry — you'll pick live only if it's drawn. More entries means more chances.`,
    },
    {
      title: "The board is shuffled once",
      body: "The organizer secretly matches a standard deck (52 cards + 2 Jokers) to the 54 numbers before the game starts. It never changes.",
    },
    {
      title: "One name is drawn each cycle",
      body: "Weighted by entries. If they already picked a number, it's revealed immediately. If it's a day-of entry, they pick live in front of everyone.",
    },
    {
      title: "Win big, or keep the game going",
      body: "The Queen of Hearts pays the jackpot and ends the game. Any other card pays a fixed prize, and the jackpot rolls into the next cycle.",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>How this pool works</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">{step.title}</p>
                <p className="text-sm text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Current jackpot</p>
          <div className="divide-y divide-border rounded-lg border border-border text-sm">
            <div className="flex items-center justify-between px-3 py-2">
              <span>Jackpot (Queen of Hearts)</span>
              <span className="font-medium">{dollars(totals.jackpotCents)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span>Price per entry</span>
              <span className="font-medium">{dollars(rules.ticketPriceCents)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span>Cycle</span>
              <span className="font-medium">{cycle === "completed" ? "Game over" : `#${cycle}`}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {percent(rules.jackpotShareBps)} of each entry feeds the jackpot; the rest goes straight to the
            fundraiser. If the Queen&apos;s number was never claimed, {percent(rules.jackpotPercentIfWinnerAbsentBps)}{" "}
            of the jackpot is still paid out and the rest seeds the next game. Entrants must be {AGE_MINIMUM}+.
            Prizes are settled by the organizer.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Consolation prizes</p>
          <div className="divide-y divide-border rounded-lg border border-border text-sm">
            <div className="flex items-center justify-between px-3 py-2">
              <span>Joker (either)</span>
              <span className="font-medium">{dollars(rules.prizeTable.joker)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span>Other Queen</span>
              <span className="font-medium">{dollars(rules.prizeTable.secondaryQueen)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span>King, Jack, or Ace</span>
              <span className="font-medium">{dollars(rules.prizeTable.highFace)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span>Numbered (2–10)</span>
              <span className="font-medium">{dollars(rules.prizeTable.numbered)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
