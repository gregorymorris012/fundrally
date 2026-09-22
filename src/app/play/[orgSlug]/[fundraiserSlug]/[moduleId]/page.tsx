import { createHash } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { joinModule } from "@/lib/module-entries";
import { PERIOD_SHORT_LABELS, type SquaresConfig } from "@/lib/squares-config";
import { deriveWinners } from "@/lib/squares-rules";
import { RulesAndPayouts, WinnersTable } from "@/components/squares/rules-and-payouts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SquaresBoard } from "@/components/squares/squares-board";
import { cn } from "@/lib/utils";
import type { QohConfig } from "@/lib/queen-of-hearts-config";
import {
  currentCycleNumber,
  revealedPositions as qohRevealedPositions,
  type QohEntry,
  type ResolvedDraw,
  type WeeklyDrawSummary,
} from "@/lib/queen-of-hearts-rules";
import { QohInfo } from "@/components/queen-of-hearts/qoh-info";
import { QohBoard } from "@/components/queen-of-hearts/qoh-board";
import { enterQueenOfHearts } from "@/lib/queen-of-hearts";

const MODULE_TYPE_LABELS: Record<string, string> = {
  squares: "Squares",
  fifty_fifty: "50/50",
  item_raffle: "Item raffle",
  wheel: "Prize wheel",
  queen_of_hearts: "Queen of Hearts",
};

const GRID_SIZE = 10;

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// Free, no-money participation page for chance-based mini-games — see
// db/schema/module-entries.ts for why this isn't a real-money checkout
// flow: CLAUDE.md's active deviation blocks that until Phase 4 compliance
// work lands, regardless of demo status. Actual dollars raised at the
// event reach the master fundraiser through offline gift entry / the
// admin "mark paid" action, tagged to this module — a separate, real
// transactions row. This page never shows paid/unpaid status — that's
// admin-only information (see the module admin page's "Reserved squares"
// card) — guests only ever see claimed vs. empty. Squares gets a real
// 10x10 grid with per-square claiming; the other types share a plain join
// list (raffle/50-50/wheel have no grid concept, and building bespoke
// gameplay for each is Phase 5/6 work, not this pass).
export default async function PlayModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; fundraiserSlug: string; moduleId: string }>;
  searchParams: Promise<{ claim?: string; pw?: string; number?: string }>;
}) {
  const { orgSlug, fundraiserSlug, moduleId } = await params;
  const { claim, pw, number: numberParam } = await searchParams;

  // Anon-capable client — db/migrations/0012_module_entries_policies.sql /
  // 0014_draws_and_squares_positions.sql are what make this readable for a
  // signed-out guest.
  const supabase = await createClient();
  const { data: fundraiser } = await supabase
    .from("fundraisers")
    .select("id, title, status, organizations!inner(id, name, slug)")
    .eq("slug", fundraiserSlug)
    .eq("organizations.slug", orgSlug)
    .maybeSingle();

  const org = fundraiser
    ? Array.isArray(fundraiser.organizations)
      ? fundraiser.organizations[0]
      : fundraiser.organizations
    : null;

  if (!fundraiser || !org || fundraiser.status !== "active") notFound();

  const { data: module_ } = await supabase
    .from("modules")
    .select("id, type, status, config")
    .eq("id", moduleId)
    .eq("fundraiser_id", fundraiser.id)
    .eq("status", "active")
    .maybeSingle();
  if (!module_) notFound();

  const isSquares = module_.type === "squares";
  const isQueenOfHearts = module_.type === "queen_of_hearts";
  const squaresConfig = (module_.config as SquaresConfig | null) ?? {};
  const qohConfig = (module_.config as QohConfig | null) ?? {};

  // Queen of Hearts' own entry flow (below, near the generic fallback):
  // never falls through to joinModuleCore, which doesn't set
  // cycle_number/card_number and would silently create an entry
  // belonging to no cycle. See "Queen of Hearts" in CLAUDE.md.
  const { data: qohEntriesRaw } = isQueenOfHearts
    ? await supabase
        .from("module_entries")
        .select("id, cycle_number, display_name, card_number, quantity")
        .eq("module_id", module_.id)
    : { data: [] };
  const qohEntriesTyped: QohEntry[] = (qohEntriesRaw ?? []).map((e) => ({
    id: e.id as string,
    cycleNumber: e.cycle_number as number,
    displayName: e.display_name,
    cardNumber: e.card_number,
    quantity: e.quantity,
  }));
  // Every weekly_draw row's full result (card included) — never the raw
  // board_shuffle draw itself, which would leak unrevealed card
  // identities to a guest. See resolveDraw()'s discipline in
  // queen-of-hearts-rules.ts and getPublicState()'s equivalent in the
  // reference this was adapted from.
  const { data: qohWeeklyDrawRows } = isQueenOfHearts
    ? await supabase
        .from("draws")
        .select("result")
        .eq("module_id", module_.id)
        .eq("segment", "weekly_draw")
        .order("cycle_number", { ascending: true })
    : { data: [] };
  const qohWeeklyDraws: ResolvedDraw[] = (qohWeeklyDrawRows ?? []).map((r) => r.result as ResolvedDraw);
  const qohWeeklyDrawsForInfo: WeeklyDrawSummary[] = qohWeeklyDraws.map((d) => ({
    cycleNumber: d.cycleNumber,
    outcome: d.outcome,
    revealedPosition: d.revealedPosition,
  }));
  const qohCycle = currentCycleNumber(qohWeeklyDrawsForInfo);
  const qohRevealedSet = qohRevealedPositions(qohWeeklyDrawsForInfo);
  const qohReveals = qohWeeklyDraws.map((d) => ({ position: d.revealedPosition, card: d.card }));
  const qohEntryNameById = new Map(qohEntriesTyped.map((e) => [e.id, e.displayName]));

  // Current cycle's board claims only — an unrevealed pick from a past
  // cycle is stale (numbers reset each cycle; only the actual winning
  // position is permanently revealed). Never shows paid/unpaid — that
  // stays admin-only, same discipline as squares' public board.
  const qohBoardEntries =
    qohCycle === "completed"
      ? []
      : qohEntriesTyped
          .filter((e) => e.cycleNumber === qohCycle && e.cardNumber != null)
          .map((e) => ({ position: e.cardNumber as number, name: e.displayName }));

  const qohSelectedNumber =
    numberParam != null && /^\d+$/.test(numberParam) ? Number(numberParam) : null;
  const qohNumberIsOpen =
    isQueenOfHearts &&
    module_.status === "active" &&
    qohCycle !== "completed" &&
    !qohConfig.pendingDrawing &&
    qohSelectedNumber != null &&
    qohSelectedNumber >= 1 &&
    qohSelectedNumber <= 54 &&
    !qohRevealedSet.has(qohSelectedNumber) &&
    !qohBoardEntries.some((e) => e.position === qohSelectedNumber);
  const colLabel = squaresConfig.colLabel || "Team A"; // across the top
  const rowLabel = squaresConfig.rowLabel || "Team B"; // down the side

  // Low-stakes access gate, checked via a ?pw= query param (see
  // src/lib/modules.ts's updateJoinPassword for why: this page has no
  // guest-session/cookie mechanism anywhere else, and adding one just for
  // this would be a new pattern for a gate that isn't a security
  // boundary). joinModuleCore re-checks this server-side on claim too —
  // this gate is about not rendering the board, not the only enforcement.
  const requiresPassword = isSquares && !!squaresConfig.joinPasswordHash;
  const suppliedHash = pw ? createHash("sha256").update(pw).digest("hex") : null;
  const passwordOk = !requiresPassword || suppliedHash === squaresConfig.joinPasswordHash;
  const pwQuery = requiresPassword && pw ? `pw=${encodeURIComponent(pw)}` : "";

  const { data: entries } = await supabase
    .from("module_entries")
    .select("display_name, note, position, created_at")
    .eq("module_id", module_.id)
    .order("created_at", { ascending: false })
    .limit(200);

  // One draw per pool: the digits are fixed for the whole game.
  const { data: draws } = isSquares
    ? await supabase
        .from("draws")
        .select("result")
        .eq("module_id", module_.id)
        .order("created_at", { ascending: true })
    : { data: [] };
  const drawResult = draws?.[0]?.result as
    | { rowDigits: number[]; colDigits: number[] }
    | undefined;

  const claimedByPosition = new Map<number, string>();
  for (const e of entries ?? []) {
    if (e.position != null) claimedByPosition.set(e.position, e.display_name);
  }
  const winners = deriveWinners(squaresConfig, drawResult, claimedByPosition);
  const claimPosition =
    claim != null && /^\d+$/.test(claim) ? Number(claim) : null;
  const claimIsOpen =
    passwordOk &&
    !squaresConfig.locked &&
    claimPosition != null &&
    claimPosition >= 0 &&
    claimPosition < GRID_SIZE * GRID_SIZE &&
    !claimedByPosition.has(claimPosition);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div className="text-center">
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {MODULE_TYPE_LABELS[module_.type] ?? module_.type}
        </h1>
        <p className="text-sm text-muted-foreground">
          {fundraiser.title} &middot; {org.name}
        </p>
        {isSquares && squaresConfig.pricePerSquareCents ? (
          <p className="mt-1 text-sm font-medium text-foreground">
            {centsToDollars(squaresConfig.pricePerSquareCents)} per square
          </p>
        ) : null}
      </div>

      <Alert variant="warning">
        <AlertTitle>Demo entry &mdash; no in-app payment</AlertTitle>
        <AlertDescription>
          {isSquares && squaresConfig.pricePerSquareCents
            ? "Claiming a square reserves it — pay the organizer directly (cash, Venmo, etc.) to confirm it. This app never processes payment."
            : "Joining here is free and for demo purposes only. Real-money entry isn't available for this game yet."}
        </AlertDescription>
      </Alert>

      {requiresPassword && !passwordOk ? (
        <Card>
          <CardHeader>
            <CardTitle>Password required</CardTitle>
          </CardHeader>
          <CardContent>
            <form method="get" className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pw">Board password</Label>
                <Input id="pw" name="pw" type="password" required autoFocus />
              </div>
              <Button type="submit" className="w-full">
                View board
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : isQueenOfHearts ? (
        <>
          {qohConfig.pendingDrawing ? (
            <Alert variant="warning">
              <AlertTitle>Entries are paused</AlertTitle>
              <AlertDescription>
                This cycle&apos;s drawing already picked a winner who&apos;s choosing their number live — entries
                reopen once that&apos;s resolved.
              </AlertDescription>
            </Alert>
          ) : qohCycle === "completed" ? (
            <Alert>
              <AlertTitle>This game has ended</AlertTitle>
              <AlertDescription>The Queen of Hearts was drawn — thanks for playing!</AlertDescription>
            </Alert>
          ) : (
            qohSelectedNumber != null &&
            qohNumberIsOpen && (
              <Card>
                <CardHeader>
                  <CardTitle>Entering with #{qohSelectedNumber}</CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={enterQueenOfHearts} className="space-y-3">
                    <input type="hidden" name="orgId" value={org.id} />
                    <input type="hidden" name="moduleId" value={module_.id} />
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                    <input type="hidden" name="cardNumber" value={qohSelectedNumber} />
                    <div className="space-y-1.5">
                      <Label htmlFor="qoh-name">Your name</Label>
                      <Input id="qoh-name" name="displayName" required autoFocus maxLength={100} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="qoh-quantity">Entries</Label>
                      <Input id="qoh-quantity" name="quantity" type="number" min={1} defaultValue={1} className="w-20" />
                    </div>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="confirmedAge18Plus" required className="mt-0.5 h-4 w-4 accent-[var(--selection)]" />
                      <span>I&apos;m 18 or older.</span>
                    </label>
                    <Button type="submit" className="w-full">
                      Enter with #{qohSelectedNumber}
                      {qohConfig.ticketPriceCents ? ` (${centsToDollars(qohConfig.ticketPriceCents)}/entry)` : " (demo)"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )
          )}

          <Card>
            <CardHeader>
              <CardTitle>
                Board — {qohCycle === "completed" ? "game over" : `cycle #${qohCycle}`}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {qohCycle !== "completed" && !qohConfig.pendingDrawing && (
                <p className="text-xs text-muted-foreground">
                  Tap an open number to enter with it, or enter without one below — you&apos;ll pick live if you&apos;re
                  drawn.
                </p>
              )}
              <QohBoard
                entries={qohBoardEntries}
                reveals={qohReveals}
                showNumbers={qohConfig.showBoardNumbers !== false}
                selectedPosition={qohSelectedNumber}
                claimHrefBase={
                  qohCycle !== "completed" && !qohConfig.pendingDrawing
                    ? `/play/${orgSlug}/${fundraiserSlug}/${module_.id}?number=`
                    : null
                }
              />
            </CardContent>
          </Card>

          {qohCycle !== "completed" && !qohConfig.pendingDrawing && (
            <Card>
              <CardHeader>
                <CardTitle>Enter without a number</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">
                  Don&apos;t want to pick now? Join as a &quot;day-of&quot; entry — you&apos;ll choose live, in front of
                  everyone, only if you&apos;re drawn.
                </p>
                <form action={enterQueenOfHearts} className="space-y-3">
                  <input type="hidden" name="orgId" value={org.id} />
                  <input type="hidden" name="moduleId" value={module_.id} />
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="qoh-dayof-name">Your name</Label>
                      <Input id="qoh-dayof-name" name="displayName" required maxLength={100} className="w-56" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="qoh-dayof-quantity">Entries</Label>
                      <Input id="qoh-dayof-quantity" name="quantity" type="number" min={1} defaultValue={1} className="w-20" />
                    </div>
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="confirmedAge18Plus" required className="mt-0.5 h-4 w-4 accent-[var(--selection)]" />
                    <span>I&apos;m 18 or older.</span>
                  </label>
                  <Button type="submit" variant="outline">
                    Enter without a number
                    {qohConfig.ticketPriceCents ? ` (${centsToDollars(qohConfig.ticketPriceCents)}/entry)` : " (demo)"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {qohWeeklyDraws.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Past winners</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border rounded-lg border border-border text-sm">
                  {qohWeeklyDraws
                    .slice()
                    .reverse()
                    .map((d) => (
                      <div key={d.cycleNumber} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <div>
                          <p className="font-medium text-foreground">
                            Cycle #{d.cycleNumber} — #{d.revealedPosition} · {d.card.label}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {qohEntryNameById.get(d.winningEntryId) ?? "Unknown entrant"}
                          </p>
                        </div>
                        <p className="font-medium text-foreground">
                          {d.outcome === "JACKPOT" ? `Jackpot — ${centsToDollars(d.payoutCents ?? 0)}` : centsToDollars(d.prizeCents ?? 0)}
                        </p>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          <QohInfo config={qohConfig} entries={qohEntriesTyped} weeklyDraws={qohWeeklyDrawsForInfo} />
        </>
      ) : isSquares ? (
        <>
          {claimIsOpen && (
            <Card>
              <CardHeader>
                <CardTitle>Claiming square #{(claimPosition ?? 0) + 1}</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={joinModule} className="space-y-3">
                  <input type="hidden" name="orgId" value={org.id} />
                  <input type="hidden" name="moduleId" value={module_.id} />
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                  <input type="hidden" name="position" value={claimPosition} />
                  <input type="hidden" name="password" value={pw ?? ""} />
                  <div className="space-y-1.5">
                    <Label htmlFor="displayName">Your name</Label>
                    <Input id="displayName" name="displayName" required autoFocus />
                  </div>
                  <Button type="submit" className="w-full">
                    Claim square #{(claimPosition ?? 0) + 1}
                    {squaresConfig.pricePerSquareCents
                      ? ` (${centsToDollars(squaresConfig.pricePerSquareCents)})`
                      : " (demo)"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {squaresConfig.locked && (
            <Alert>
              <AlertTitle>Claiming is temporarily paused</AlertTitle>
              <AlertDescription>
                The organizer has locked this board — existing squares are
                unaffected.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>
                Board ({claimedByPosition.size}/{GRID_SIZE * GRID_SIZE} claimed)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!drawResult && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Numbers haven&apos;t been drawn yet — the organizer draws
                  them once the board fills up.
                </p>
              )}
              <SquaresBoard
                colLabel={colLabel}
                rowLabel={rowLabel}
                colColor={squaresConfig.colColor}
                rowColor={squaresConfig.rowColor}
                colDigits={drawResult?.colDigits}
                rowDigits={drawResult?.rowDigits}
                entries={(entries ?? [])
                  .filter((e) => e.position != null)
                  .map((e) => ({ position: e.position as number, name: e.display_name }))}
                showNumbers={squaresConfig.showSquareNumbers !== false}
                selectedPosition={claimIsOpen ? claimPosition : null}
                winners={winners
                  .filter((w) => w.position != null)
                  .map((w) => ({ position: w.position as number, label: PERIOD_SHORT_LABELS[w.period] }))}
                claimHrefBase={
                  squaresConfig.locked
                    ? null
                    : `/play/${orgSlug}/${fundraiserSlug}/${module_.id}?claim=`
                }
                claimHrefSuffix={pwQuery ? `&${pwQuery}` : ""}
              />
            </CardContent>
          </Card>

          {winners.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Winners</CardTitle>
              </CardHeader>
              <CardContent>
                <WinnersTable winners={winners} colLabel={colLabel} rowLabel={rowLabel} />
              </CardContent>
            </Card>
          )}

          <RulesAndPayouts config={squaresConfig} colLabel={colLabel} rowLabel={rowLabel} />
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Join</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={joinModule} className="space-y-3">
                <input type="hidden" name="orgId" value={org.id} />
                <input type="hidden" name="moduleId" value={module_.id} />
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                <div className="space-y-1.5">
                  <Label htmlFor="displayName">Your name</Label>
                  <Input id="displayName" name="displayName" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="note">Note (optional)</Label>
                  <Input id="note" name="note" />
                </div>
                <Button type="submit" className="w-full">
                  Join for free (demo)
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Who&apos;s joined ({entries?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {entries?.length ? (
                entries.map((e, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span>{e.display_name}</span>
                    {e.note && <span className="text-muted-foreground">{e.note}</span>}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No one yet &mdash; be the first!
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <a
        href={`/org/${orgSlug}`}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-center")}
      >
        Hosted by {org.name}
      </a>
    </div>
  );
}
