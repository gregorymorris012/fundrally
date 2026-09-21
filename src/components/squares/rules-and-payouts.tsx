import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PERIOD_LABELS,
  PERIOD_SHORT_LABELS,
  type SquaresConfig,
} from "@/lib/squares-config";
import { computePayouts, resolveRules, type PeriodWinner } from "@/lib/squares-rules";

function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function percent(bps: number) {
  return `${Number((bps / 100).toFixed(2))}%`;
}

// The pool's rules and payout table, generated from its settings so what
// players read can't drift from what the organizer configured. Shown on the
// public page (and reusable on the admin side). Amounts are informational —
// the organizer settles any payouts offline.
export function RulesAndPayouts({
  config,
  colLabel,
  rowLabel,
}: {
  config: SquaresConfig;
  colLabel: string;
  rowLabel: string;
}) {
  const rules = resolveRules(config);
  const payouts = computePayouts(config);
  const charityPct = percent(rules.charityBps);
  const winnersPct = percent(10_000 - rules.charityBps);

  const steps = [
    {
      title: "Claim your squares",
      body: "Pick open squares on the board before the pool locks. Each square is where one row meets one column.",
    },
    {
      title: "Numbers are drawn once",
      body: "When the pool locks, the organizer draws random digits (0–9) for the columns and rows. They stay the same for the whole game.",
    },
    {
      title: "Winning squares",
      body: `${rules.periods.length > 1 ? "At the end of each scoring period" : "At the end of the game"}, the last digit of ${colLabel}'s score picks the column and the last digit of ${rowLabel}'s score picks the row. The square where they meet wins that period.`,
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
          <p className="text-sm font-medium text-foreground">Where the money goes</p>
          <div className="divide-y divide-border rounded-lg border border-border text-sm">
            <div className="flex items-center justify-between px-3 py-2">
              <span>Fundraiser</span>
              <span className="font-medium">
                {charityPct}
                {payouts && ` · ${dollars(payouts.charityCents)}`}
              </span>
            </div>
            {rules.periods.map((period, i) => (
              <div key={period} className="flex items-center justify-between px-3 py-2">
                <span>{PERIOD_LABELS[period]}</span>
                <span className="font-medium">
                  {payouts
                    ? dollars(payouts.periods[i].cents)
                    : percent(Math.round(((rules.splitBps[period] ?? 0) * (10_000 - rules.charityBps)) / 10_000))}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {charityPct} of the pot goes to the fundraiser; the remaining {winnersPct}{" "}
            {rules.periods.length > 1 ? "is split across the periods above" : "goes to the final winner"}
            {payouts ? ` (pot: 100 squares × ${dollars(config.pricePerSquareCents ?? 0)} = ${dollars(payouts.potCents)})` : ""}.
            Overtime counts toward the final. Prizes are settled by the organizer.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// Winners so far, derived from the scores the organizer has entered.
export function WinnersTable({
  winners,
  colLabel,
  rowLabel,
}: {
  winners: PeriodWinner[];
  colLabel: string;
  rowLabel: string;
}) {
  if (winners.length === 0) return null;
  return (
    <div className="divide-y divide-border rounded-lg border border-border text-sm">
      {winners.map((w) => (
        <div key={w.period} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div>
            <p className="font-medium text-foreground">{PERIOD_LABELS[w.period]}</p>
            <p className="text-xs text-muted-foreground">
              {colLabel} {w.score.col} – {rowLabel} {w.score.row}
              {w.position != null && ` · square #${w.position + 1}`}
            </p>
          </div>
          <div className="text-right">
            <p className="font-medium text-foreground">
              {w.position == null ? "Numbers not drawn" : (w.holder ?? "No one holds that square")}
            </p>
            {w.prizeCents != null && (
              <p className="text-xs text-muted-foreground">{dollars(w.prizeCents)}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export { PERIOD_SHORT_LABELS };
