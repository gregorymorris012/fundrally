import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { joinModule } from "@/lib/module-entries";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const MODULE_TYPE_LABELS: Record<string, string> = {
  squares: "Squares",
  fifty_fifty: "50/50",
  item_raffle: "Item raffle",
  wheel: "Prize wheel",
};

const GRID_SIZE = 10;

// Free, no-money participation page for chance-based mini-games — see
// db/schema/module-entries.ts for why this isn't a real-money checkout
// flow: CLAUDE.md's active deviation blocks that until Phase 4 compliance
// work lands, regardless of demo status. Actual dollars raised at the
// event reach the master fundraiser through offline gift entry
// (org-admin-only, src/lib/payments/offline-gift.ts), tagged to this
// module — a separate, real transactions row. Squares gets a real 10x10
// grid with per-square claiming; the other types share a plain join list
// (raffle/50-50/wheel have no grid concept, and building bespoke gameplay
// for each is Phase 5/6 work, not this pass).
export default async function PlayModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; fundraiserSlug: string; moduleId: string }>;
  searchParams: Promise<{ claim?: string }>;
}) {
  const { orgSlug, fundraiserSlug, moduleId } = await params;
  const { claim } = await searchParams;

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
    .select("id, type, status")
    .eq("id", moduleId)
    .eq("fundraiser_id", fundraiser.id)
    .eq("status", "active")
    .maybeSingle();
  if (!module_) notFound();

  const { data: entries } = await supabase
    .from("module_entries")
    .select("display_name, note, position, created_at")
    .eq("module_id", module_.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const isSquares = module_.type === "squares";

  const { data: draw } = isSquares
    ? await supabase
        .from("draws")
        .select("result")
        .eq("module_id", module_.id)
        .maybeSingle()
    : { data: null };
  const drawResult = draw?.result as
    | { rowDigits: number[]; colDigits: number[] }
    | undefined;

  const claimedByPosition = new Map<number, string>();
  for (const e of entries ?? []) {
    if (e.position != null) claimedByPosition.set(e.position, e.display_name);
  }
  const claimPosition =
    claim != null && /^\d+$/.test(claim) ? Number(claim) : null;
  const claimIsOpen =
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
      </div>

      <Alert variant="warning">
        <AlertTitle>Demo entry &mdash; no payment</AlertTitle>
        <AlertDescription>
          Joining here is free and for demo purposes only. Real-money entry
          isn&apos;t available for this game yet.
        </AlertDescription>
      </Alert>

      {isSquares ? (
        <>
          {claimIsOpen && (
            <Card>
              <CardHeader>
                <CardTitle>Claiming square #{claimPosition}</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={joinModule} className="space-y-3">
                  <input type="hidden" name="orgId" value={org.id} />
                  <input type="hidden" name="moduleId" value={module_.id} />
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                  <input type="hidden" name="position" value={claimPosition} />
                  <div className="space-y-1.5">
                    <Label htmlFor="displayName">Your name</Label>
                    <Input id="displayName" name="displayName" required autoFocus />
                  </div>
                  <Button type="submit" className="w-full">
                    Claim square #{claimPosition} (demo)
                  </Button>
                </form>
              </CardContent>
            </Card>
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
              <div className="overflow-x-auto">
                <div
                  className="grid w-fit gap-0.5"
                  style={{
                    gridTemplateColumns: `2.5rem repeat(${GRID_SIZE}, 2.5rem)`,
                  }}
                >
                  <div />
                  {Array.from({ length: GRID_SIZE }, (_, col) => (
                    <div
                      key={`col-${col}`}
                      className="flex h-10 items-center justify-center text-xs font-mono text-muted-foreground"
                    >
                      {drawResult ? drawResult.colDigits[col] : ""}
                    </div>
                  ))}
                  {Array.from({ length: GRID_SIZE }, (_, row) => (
                    <Fragment key={`row-${row}`}>
                      <div className="flex h-10 items-center justify-center text-xs font-mono text-muted-foreground">
                        {drawResult ? drawResult.rowDigits[row] : ""}
                      </div>
                      {Array.from({ length: GRID_SIZE }, (_, col) => {
                        const position = row * GRID_SIZE + col;
                        const claimedName = claimedByPosition.get(position);
                        return claimedName ? (
                          <div
                            key={position}
                            title={claimedName}
                            className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-sm bg-primary/10 text-[10px] font-medium text-primary"
                          >
                            {claimedName.slice(0, 3)}
                          </div>
                        ) : (
                          <Link
                            key={position}
                            href={`/play/${orgSlug}/${fundraiserSlug}/${module_.id}?claim=${position}`}
                            className={cn(
                              "flex h-10 w-10 items-center justify-center rounded-sm border border-dashed border-border text-[10px] text-muted-foreground hover:bg-muted",
                              claimPosition === position && "border-primary",
                            )}
                          >
                            {position}
                          </Link>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
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
