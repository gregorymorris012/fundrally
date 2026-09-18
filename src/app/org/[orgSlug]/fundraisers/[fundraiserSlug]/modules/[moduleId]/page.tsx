import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createProduct } from "@/lib/products";
import {
  updateModuleStatus,
  updateSquaresBoard,
  updateJoinPassword,
  toggleSquaresLock,
  deleteModule,
} from "@/lib/modules";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { drawSquares } from "@/lib/draws";
import {
  SEGMENTS_BY_STRUCTURE,
  type SquaresConfig,
  type DrawSegment,
} from "@/lib/squares-config";
import {
  markSquarePaid,
  voidSquarePayment,
  releaseSquare,
  releaseStaleSquares,
} from "@/lib/module-entries";
import { searchUpcomingEspnEvents, type EspnLeague } from "@/lib/sports-data/espn";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CopyLinkButton } from "@/components/copy-link-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const MODULE_TYPE_LABELS: Record<string, string> = {
  product: "Product sale",
  squares: "Squares",
  fifty_fifty: "50/50",
  item_raffle: "Item raffle",
  wheel: "Prize wheel",
  auction: "Auction",
  golf: "Golf outing",
};

const CHANCE_MODULE_TYPES = ["wheel", "squares", "fifty_fifty", "item_raffle"];

const moduleStatusVariant = {
  draft: "secondary",
  active: "success",
  paused: "warning",
  closed: "outline",
} as const;

// Mirrors MODULE_STATUS_TRANSITIONS in src/lib/modules.ts — kept in sync
// there (server-authoritative check) and here (which buttons to show).
const NEXT_ACTIONS: Record<string, { status: string; label: string }[]> = {
  draft: [{ status: "active", label: "Launch" }],
  active: [
    { status: "paused", label: "Pause" },
    { status: "closed", label: "Close" },
  ],
  paused: [
    { status: "active", label: "Resume" },
    { status: "closed", label: "Close" },
  ],
  closed: [],
};

const SEGMENT_LABELS: Record<DrawSegment, string> = {
  q1: "1st quarter",
  q2: "2nd quarter",
  q3: "3rd quarter",
  half: "Halftime",
  final: "Final",
};

const PAYOUT_STRUCTURE_LABELS = {
  final_only: "Final score only",
  half_final: "Halftime + Final",
  quarters: "Every quarter + Final",
} as const;

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

const ESPN_RESULTS_SHOWN = 25;

const ESPN_LEAGUE_LABELS: Record<EspnLeague, string> = {
  nfl: "NFL",
  "college-football": "NCAAF",
  nba: "NBA",
  wnba: "WNBA",
  "college-basketball": "NCAAB",
};

export default async function ModuleAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; fundraiserSlug: string; moduleId: string }>;
  searchParams: Promise<{ espnLeague?: string; espnQuery?: string }>;
}) {
  const { orgSlug, fundraiserSlug, moduleId } = await params;
  const { espnLeague, espnQuery } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, slug")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (!org) notFound();

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) notFound();
  const isAdmin = membership.role === "owner" || membership.role === "admin";

  const { data: fundraiser } = await supabase
    .from("fundraisers")
    .select("id, title, slug")
    .eq("org_id", org.id)
    .eq("slug", fundraiserSlug)
    .maybeSingle();
  if (!fundraiser) notFound();

  const { data: module_ } = await supabase
    .from("modules")
    .select("id, type, status, name, config")
    .eq("id", moduleId)
    .eq("fundraiser_id", fundraiser.id)
    .maybeSingle();
  if (!module_) notFound();

  const isChanceModule = CHANCE_MODULE_TYPES.includes(module_.type);
  const isSquares = module_.type === "squares";
  const squaresConfig = (module_.config as SquaresConfig | null) ?? {};
  const payoutStructure = squaresConfig.payoutStructure ?? "final_only";
  const segments = SEGMENTS_BY_STRUCTURE[payoutStructure];

  const { data: entries } = isSquares
    ? await supabase
        .from("module_entries")
        .select("id, display_name, note, position, price_cents, transaction_id, created_at")
        .eq("module_id", module_.id)
        .order("position", { ascending: true })
    : { data: [] };

  const { count: entryCount } = isChanceModule
    ? await supabase
        .from("module_entries")
        .select("id", { count: "exact", head: true })
        .eq("module_id", module_.id)
    : { count: 0 };

  const { data: draws } = isSquares
    ? await supabase
        .from("draws")
        .select("segment, result, created_at")
        .eq("module_id", module_.id)
    : { data: [] };
  const drawBySegment = new Map(
    (draws ?? []).map((d) => [
      d.segment as DrawSegment,
      d as { segment: DrawSegment; result: { rowDigits: number[]; colDigits: number[] }; created_at: string },
    ]),
  );

  const { data: activity } = isSquares
    ? await supabase
        .from("audit_log")
        .select("id, actor, action, after, created_at")
        .eq("org_id", org.id)
        .filter("after->>module_id", "eq", module_.id)
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: [] };

  const { data: products } = module_.type === "product"
    ? await supabase
        .from("products")
        .select("id, name, price_cents, status")
        .eq("module_id", module_.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  const { data: orders } = module_.type === "product"
    ? await supabase
        .from("orders")
        .select(
          "id, status, created_at, participants(display_name, email), order_items(quantity, unit_price_cents, products(name))",
        )
        .eq("module_id", module_.id)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };

  const espnResults =
    isSquares && isAdmin && espnLeague
      ? await searchUpcomingEspnEvents({
          league: espnLeague as EspnLeague,
          query: espnQuery,
        })
      : [];
  // A year-wide, unfiltered search can return thousands of games (college
  // basketball especially), and every row carries its own form — cap what
  // renders and tell the admin to narrow by team name for the rest.
  const espnShown = espnResults.slice(0, ESPN_RESULTS_SHOWN);

  const claimedEntries = (entries ?? []).filter((e) => e.position != null);
  const paidCount = claimedEntries.filter((e) => e.transaction_id).length;
  const unpaidCount = claimedEntries.length - paidCount;
  const collectedCents = claimedEntries
    .filter((e) => e.transaction_id)
    .reduce((sum, e) => sum + (e.price_cents ?? 0), 0);
  const claimedByPosition = new Map(claimedEntries.map((e) => [e.position as number, e]));

  const publicPath = `/play/${orgSlug}/${fundraiserSlug}/${module_.id}`;
  const matchupTitle =
    isSquares && (squaresConfig.rowLabel || squaresConfig.colLabel)
      ? `${squaresConfig.rowLabel || "Team A"} vs. ${squaresConfig.colLabel || "Team B"}`
      : MODULE_TYPE_LABELS[module_.type] ?? module_.type;
  const displayTitle = module_.name || matchupTitle;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {displayTitle}
          </h1>
          <Badge
            variant={
              moduleStatusVariant[
                module_.status as keyof typeof moduleStatusVariant
              ]
            }
          >
            {module_.status}
          </Badge>
          {isSquares && (
            <Badge variant={squaresConfig.locked ? "warning" : "success"}>
              {squaresConfig.locked ? "Locked" : "Open"}
            </Badge>
          )}
        </div>
        <Link
          href={`/org/${orgSlug}/fundraisers/${fundraiserSlug}`}
          className="text-sm text-muted-foreground underline"
        >
          Back to {fundraiser.title}
        </Link>
      </div>

      {isChanceModule && (
        <Alert variant="warning">
          <AlertTitle>Demo mode only</AlertTitle>
          <AlertDescription>
            No real-money checkout exists for this module type yet — that
            requires Phase 4&apos;s compliance work, regardless of Stripe or
            demo status. {isSquares
              ? "Guests only reserve a square here; mark a square paid in the Reserved squares list once you've collected money in person — that logs a real offline gift, same as the fundraiser dashboard."
              : "Use offline gift entry on the fundraiser dashboard to record any real-world activity for this module."}
          </AlertDescription>
        </Alert>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            {NEXT_ACTIONS[module_.status]?.length ? (
              NEXT_ACTIONS[module_.status].map((action) => (
                <form key={action.status} action={updateModuleStatus}>
                  <input type="hidden" name="moduleId" value={module_.id} />
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                  <input type="hidden" name="nextStatus" value={action.status} />
                  <Button
                    type="submit"
                    variant={action.status === "closed" ? "outline" : "default"}
                  >
                    {action.label}
                  </Button>
                </form>
              ))
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  This module is closed.
                </p>
                <form action={deleteModule}>
                  <input type="hidden" name="moduleId" value={module_.id} />
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                  <ConfirmSubmitButton
                    type="submit"
                    variant="outline"
                    size="sm"
                    confirmMessage={`Delete "${displayTitle}"? This can't be undone. Only allowed because it's closed with no payment activity.`}
                  >
                    Delete
                  </ConfirmSubmitButton>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {module_.type === "product" && (
        <div className="flex max-w-2xl flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Shop</CardTitle>
            </CardHeader>
            <CardContent>
              <a
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={`/shop/${orgSlug}/${fundraiserSlug}`}
              >
                View public shop page
              </a>
            </CardContent>
          </Card>

          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Add product</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={createProduct} className="space-y-3">
                  <input type="hidden" name="orgId" value={org.id} />
                  <input type="hidden" name="moduleId" value={module_.id} />
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" name="name" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="description">Description</Label>
                    <Input id="description" name="description" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="price">Price (USD)</Label>
                    <Input id="price" name="price" type="number" min="0.01" step="0.01" required />
                  </div>
                  <Button type="submit">Add product</Button>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Products</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {products?.length ? (
                products.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span>{p.name}</span>
                    <span className="text-muted-foreground">
                      ${(p.price_cents / 100).toFixed(2)} ({p.status})
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No products yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Orders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {orders?.length ? (
                orders.map((order) => {
                  const items = Array.isArray(order.order_items) ? order.order_items : [];
                  const totalCents = items.reduce(
                    (sum, item) => sum + item.quantity * item.unit_price_cents,
                    0,
                  );
                  const participant = Array.isArray(order.participants)
                    ? order.participants[0]
                    : order.participants;
                  return (
                    <div key={order.id} className="text-sm">
                      <div className="flex items-center justify-between">
                        <span>{participant?.display_name ?? "Guest"}</span>
                        <span className="text-muted-foreground">
                          ${(totalCents / 100).toFixed(2)} ({order.status})
                        </span>
                      </div>
                      <p className="text-muted-foreground">
                        {items
                          .map((item) => {
                            const product = Array.isArray(item.products)
                              ? item.products[0]
                              : item.products;
                            return `${item.quantity}x ${product?.name ?? "item"}`;
                          })
                          .join(", ")}
                      </p>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">No orders yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {isChanceModule && !isSquares && (
        <div className="max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>Public entry page</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Share this link so people can join {MODULE_TYPE_LABELS[module_.type]} —
                free demo entry, no in-app payment. {entryCount ?? 0} joined so far.
                Log any real-world money collected via offline gift entry on
                the fundraiser dashboard, tagged to this module.
              </p>
              {module_.status === "active" ? (
                <a
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  href={publicPath}
                >
                  View public entry page
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Launch this module to make the entry page public.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {isSquares && (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
          {/* Main column: the board itself comes first, then its
              configuration, then operational detail — the reverse of a
              settings-first layout, so the thing an organizer actually
              cares about (the board) is immediately visible instead of
              buried under every settings card. */}
          <div className="flex min-w-0 flex-col gap-6">
            {isAdmin && (
              <Card>
                <CardHeader>
                  <CardTitle>Customize board</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Searches ESPN&apos;s public schedule to prefill team
                      names and colors below — an unofficial, best-effort
                      convenience. If a search fails or a game isn&apos;t
                      listed, just fill in the fields below by hand.
                    </p>
                    <form
                      key={`${espnLeague ?? "nfl"}:${espnQuery ?? ""}`}
                      method="get"
                      className="flex flex-wrap items-end gap-3"
                    >
                      <div className="space-y-1.5">
                        <Label htmlFor="espnLeague">League</Label>
                        <select
                          id="espnLeague"
                          name="espnLeague"
                          defaultValue={espnLeague ?? "nfl"}
                          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                        >
                          {(Object.keys(ESPN_LEAGUE_LABELS) as EspnLeague[]).map((league) => (
                            <option key={league} value={league}>
                              {ESPN_LEAGUE_LABELS[league]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="espnQuery">Team name</Label>
                        <Input
                          id="espnQuery"
                          name="espnQuery"
                          defaultValue={espnQuery ?? ""}
                          placeholder="e.g. Steelers"
                        />
                      </div>
                      <Button type="submit" variant="outline">
                        Search
                      </Button>
                    </form>

                    {espnLeague && (
                      espnResults.length ? (
                        <>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Matchup</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead className="text-right">Use</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {espnShown.map((event) => (
                              <TableRow key={event.id}>
                                <TableCell>{event.name}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {new Date(event.date).toLocaleDateString()}
                                </TableCell>
                                <TableCell className="text-right">
                                  <form action={updateSquaresBoard}>
                                    <input type="hidden" name="moduleId" value={module_.id} />
                                    <input type="hidden" name="orgSlug" value={orgSlug} />
                                    <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                                    <input type="hidden" name="name" value={event.name} />
                                    <input type="hidden" name="colLabel" value={event.homeTeam.name} />
                                    <input type="hidden" name="rowLabel" value={event.awayTeam.name} />
                                    <input
                                      type="hidden"
                                      name="colColor"
                                      value={event.homeTeam.color ?? squaresConfig.colColor ?? "#1f2937"}
                                    />
                                    <input
                                      type="hidden"
                                      name="rowColor"
                                      value={event.awayTeam.color ?? squaresConfig.rowColor ?? "#6b7280"}
                                    />
                                    <input
                                      type="hidden"
                                      name="pricePerSquare"
                                      value={
                                        squaresConfig.pricePerSquareCents
                                          ? (squaresConfig.pricePerSquareCents / 100).toFixed(2)
                                          : ""
                                      }
                                    />
                                    <input type="hidden" name="payoutStructure" value={payoutStructure} />
                                    <Button type="submit" variant="outline" size="sm">
                                      Use this game
                                    </Button>
                                  </form>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {espnResults.length > espnShown.length && (
                          <p className="text-sm text-muted-foreground">
                            Showing the first {espnShown.length} of {espnResults.length} games —
                            type a team name above to narrow the list.
                          </p>
                        )}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No games found — enter teams manually below.
                        </p>
                      )
                    )}
                  </div>

                  <Separator />

                  {/* Keyed on the saved config so every uncontrolled Input
                      below fully remounts (fresh "initial" defaultValue)
                      whenever a save changes it, instead of React reusing
                      the same instances with a mid-life defaultValue
                      change — the latter is exactly what Base UI's
                      FieldControl warns about ("changing the default
                      value state... after being initialized"), since
                      after a server-action save + revalidatePath this
                      form re-renders with new server data but the same
                      component identity. */}
                  <form
                    key={`${module_.name ?? ""}:${JSON.stringify(squaresConfig)}`}
                    action={updateSquaresBoard}
                    className="space-y-4"
                  >
                    <input type="hidden" name="moduleId" value={module_.id} />
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                    <div className="space-y-1.5">
                      <Label htmlFor="name">Pool name</Label>
                      <Input
                        id="name"
                        name="name"
                        defaultValue={module_.name ?? ""}
                        placeholder="e.g. Office Squares — Week 3"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="colLabel">Column team (top)</Label>
                        <Input
                          id="colLabel"
                          name="colLabel"
                          defaultValue={squaresConfig.colLabel ?? ""}
                          placeholder="e.g. Patriots"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="colColor">Column color</Label>
                        <input
                          id="colColor"
                          name="colColor"
                          type="color"
                          defaultValue={squaresConfig.colColor ?? "#1f2937"}
                          className="h-9 w-full rounded-md border border-input"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="rowLabel">Row team (side)</Label>
                        <Input
                          id="rowLabel"
                          name="rowLabel"
                          defaultValue={squaresConfig.rowLabel ?? ""}
                          placeholder="e.g. Seahawks"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="rowColor">Row color</Label>
                        <input
                          id="rowColor"
                          name="rowColor"
                          type="color"
                          defaultValue={squaresConfig.rowColor ?? "#6b7280"}
                          className="h-9 w-full rounded-md border border-input"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pricePerSquare">Price per square (USD, optional)</Label>
                      <Input
                        id="pricePerSquare"
                        name="pricePerSquare"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={
                          squaresConfig.pricePerSquareCents
                            ? (squaresConfig.pricePerSquareCents / 100).toFixed(2)
                            : ""
                        }
                        placeholder="Leave blank for no price"
                      />
                    </div>
                    <fieldset className="space-y-1.5">
                      <Label>Payout structure</Label>
                      {(Object.keys(PAYOUT_STRUCTURE_LABELS) as (keyof typeof PAYOUT_STRUCTURE_LABELS)[]).map(
                        (structure) => (
                          <label key={structure} className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="payoutStructure"
                              value={structure}
                              defaultChecked={payoutStructure === structure}
                            />
                            {PAYOUT_STRUCTURE_LABELS[structure]}
                          </label>
                        ),
                      )}
                    </fieldset>
                    <Button type="submit" variant="outline">
                      Save board settings
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>
                    Board ({claimedEntries.length}/100 claimed)
                  </CardTitle>
                  {module_.status === "active" && (
                    <a
                      href={publicPath}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      View public page
                    </a>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span>{paidCount} paid</span>
                  <span>{unpaidCount} unpaid</span>
                  <span>{collectedCents ? centsToDollars(collectedCents) : "$0.00"} collected</span>
                </div>

                <div className="overflow-x-auto">
                  <div
                    className="grid w-fit gap-px bg-border"
                    style={{ gridTemplateColumns: "repeat(10, 2rem)" }}
                  >
                    {Array.from({ length: 100 }, (_, position) => {
                      const entry = claimedByPosition.get(position);
                      const bg = !entry
                        ? "bg-muted"
                        : entry.transaction_id
                          ? "bg-success/20"
                          : "bg-warning/20";
                      return (
                        <div key={position} className="group relative h-8 w-8">
                          <div
                            className={cn(
                              "flex h-8 w-8 items-center justify-center overflow-hidden text-[9px] font-medium text-foreground",
                              bg,
                            )}
                          >
                            {entry?.display_name?.slice(0, 3) ?? ""}
                          </div>
                          {entry?.display_name && (
                            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background group-hover:block">
                              {entry.display_name}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-3 w-3 bg-muted" /> Open
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-3 w-3 bg-warning/20" /> Unpaid
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-3 w-3 bg-success/20" /> Paid
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Draw numbers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Assigns row/column digits 0-9 once per segment,
                  server-side (crypto.randomInt) — can&apos;t be undone or
                  redrawn.
                </p>
                {segments.map((segment) => {
                  const draw = drawBySegment.get(segment);
                  return (
                    <div key={segment} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                      <p className="mb-1 text-sm font-medium text-foreground">
                        {SEGMENT_LABELS[segment]}
                      </p>
                      {draw ? (
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Row digits</p>
                            <p className="font-mono">{draw.result.rowDigits.join(", ")}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Column digits</p>
                            <p className="font-mono">{draw.result.colDigits.join(", ")}</p>
                          </div>
                        </div>
                      ) : isAdmin ? (
                        <form action={drawSquares}>
                          <input type="hidden" name="orgId" value={org.id} />
                          <input type="hidden" name="moduleId" value={module_.id} />
                          <input type="hidden" name="orgSlug" value={orgSlug} />
                          <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                          <input type="hidden" name="segment" value={segment} />
                          <Button type="submit" variant="outline" size="sm">
                            Draw {SEGMENT_LABELS[segment].toLowerCase()} now
                          </Button>
                        </form>
                      ) : (
                        <p className="text-sm text-muted-foreground">Not drawn yet.</p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Reserved squares</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {isAdmin && claimedEntries.length > 0 && (
                  <form action={releaseStaleSquares} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="orgId" value={org.id} />
                    <input type="hidden" name="moduleId" value={module_.id} />
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                    <div className="space-y-1.5">
                      <Label htmlFor="olderThanHours">Release unpaid squares older than (hours)</Label>
                      <Input
                        id="olderThanHours"
                        name="olderThanHours"
                        type="number"
                        min="1"
                        defaultValue={24}
                        className="w-32"
                      />
                    </div>
                    <Button type="submit" variant="outline" size="sm">
                      Release stale unpaid squares
                    </Button>
                  </form>
                )}

                {claimedEntries.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Status</TableHead>
                        {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {claimedEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="font-mono">{entry.position}</TableCell>
                          <TableCell>{entry.display_name}</TableCell>
                          <TableCell>
                            {entry.price_cents ? centsToDollars(entry.price_cents) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={entry.transaction_id ? "success" : "warning"}>
                              {entry.transaction_id ? "Paid" : "Unpaid"}
                            </Badge>
                          </TableCell>
                          {isAdmin && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                {entry.transaction_id ? (
                                  <form action={voidSquarePayment}>
                                    <input type="hidden" name="orgId" value={org.id} />
                                    <input type="hidden" name="moduleId" value={module_.id} />
                                    <input type="hidden" name="orgSlug" value={orgSlug} />
                                    <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                                    <input type="hidden" name="entryId" value={entry.id} />
                                    <Button type="submit" variant="outline" size="sm">
                                      Void payment
                                    </Button>
                                  </form>
                                ) : (
                                  <>
                                    {entry.price_cents ? (
                                      <form action={markSquarePaid} className="flex items-center gap-1">
                                        <input type="hidden" name="orgId" value={org.id} />
                                        <input type="hidden" name="fundraiserId" value={fundraiser.id} />
                                        <input type="hidden" name="moduleId" value={module_.id} />
                                        <input type="hidden" name="orgSlug" value={orgSlug} />
                                        <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                                        <input type="hidden" name="entryId" value={entry.id} />
                                        <select
                                          name="method"
                                          required
                                          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                                        >
                                          <option value="cash">Cash</option>
                                          <option value="check">Check</option>
                                          <option value="in_kind">In-kind</option>
                                          <option value="other">Other</option>
                                        </select>
                                        <Button type="submit" variant="outline" size="sm">
                                          Mark paid
                                        </Button>
                                      </form>
                                    ) : null}
                                    <form action={releaseSquare}>
                                      <input type="hidden" name="orgId" value={org.id} />
                                      <input type="hidden" name="moduleId" value={module_.id} />
                                      <input type="hidden" name="orgSlug" value={orgSlug} />
                                      <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                                      <input type="hidden" name="entryId" value={entry.id} />
                                      <Button type="submit" variant="outline" size="sm">
                                        Release
                                      </Button>
                                    </form>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground">No squares claimed yet.</p>
                )}
              </CardContent>
            </Card>

            {activity && activity.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Activity log</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {activity.map((row) => (
                    <div key={row.id} className="flex items-center justify-between text-sm">
                      <span>{formatActivity(row.action, row.after)}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar: persistent status + quick actions, independent of
              how far you've scrolled the main column. */}
          <div className="flex flex-col gap-6">
            {isAdmin && (
              <Card>
                <CardHeader>
                  <CardTitle>Access</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {squaresConfig.locked ? "Locked" : "Open"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {squaresConfig.locked ? "New claims paused" : "Guests can claim squares"}
                      </p>
                    </div>
                    <form action={toggleSquaresLock}>
                      <input type="hidden" name="orgId" value={org.id} />
                      <input type="hidden" name="moduleId" value={module_.id} />
                      <input type="hidden" name="orgSlug" value={orgSlug} />
                      <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                      <input type="hidden" name="locked" value={(!squaresConfig.locked).toString()} />
                      <Button type="submit" variant="outline" size="sm">
                        {squaresConfig.locked ? "Unlock" : "Lock"}
                      </Button>
                    </form>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-sm font-medium text-foreground">
                        Join password
                      </Label>
                      <Badge variant={squaresConfig.joinPasswordHash ? "secondary" : "outline"}>
                        {squaresConfig.joinPasswordHash ? "Protected" : "Open"}
                      </Badge>
                    </div>
                    <form action={updateJoinPassword} className="flex items-center gap-2">
                      <input type="hidden" name="moduleId" value={module_.id} />
                      <input type="hidden" name="orgSlug" value={orgSlug} />
                      <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        placeholder={squaresConfig.joinPasswordHash ? "New password" : "Set a password"}
                        className="h-8 text-xs"
                      />
                      <Button type="submit" variant="outline" size="sm">
                        Save
                      </Button>
                    </form>
                    <p className="text-xs text-muted-foreground">Leave blank and save to remove it.</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Pool details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Invite link</span>
                  <CopyLinkButton path={publicPath} variant="outline" size="sm" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Price per square</span>
                  <span>
                    {squaresConfig.pricePerSquareCents
                      ? centsToDollars(squaresConfig.pricePerSquareCents)
                      : "Not set"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Payout structure</span>
                  <span>{PAYOUT_STRUCTURE_LABELS[payoutStructure]}</span>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Claimed</span>
                    <span>{claimedEntries.length} of 100</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${claimedEntries.length}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Numbers drawn</span>
                  <span>
                    {drawBySegment.size} of {segments.length}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function formatActivity(action: string, after: unknown): string {
  const a = (after ?? {}) as Record<string, unknown>;
  switch (action) {
    case "square.paid":
      return `Square #${a.position} marked paid${
        typeof a.amount_cents === "number" ? ` (${centsToDollars(a.amount_cents)})` : ""
      }`;
    case "square.payment_voided":
      return `Payment voided for square #${a.position}`;
    case "square.released":
      return `Square #${a.position} released (was ${a.display_name})`;
    case "squares.stale_swept":
      return `Released ${
        Array.isArray(a.released_positions) ? a.released_positions.length : 0
      } stale unpaid squares`;
    case "squares.locked":
      return "Board locked";
    case "squares.unlocked":
      return "Board unlocked";
    default:
      return action;
  }
}
