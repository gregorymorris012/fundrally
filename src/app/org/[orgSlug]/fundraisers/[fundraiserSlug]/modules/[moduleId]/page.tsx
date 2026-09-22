import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createProduct } from "@/lib/products";
import {
  updateModuleStatus,
  updateSquaresBoard,
  updatePayoutRules,
  saveSquaresScore,
  updateJoinPassword,
  toggleSquaresLock,
  deleteModule,
} from "@/lib/modules";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { drawSquares } from "@/lib/draws";
import {
  PAYOUT_STRUCTURE_OPTIONS,
  PERIOD_LABELS,
  PERIOD_SHORT_LABELS,
  type SquaresConfig,
} from "@/lib/squares-config";
import { deriveWinners, resolveRules } from "@/lib/squares-rules";
import { PayoutRulesForm } from "@/components/squares/payout-rules-form";
import { RulesAndPayouts, WinnersTable } from "@/components/squares/rules-and-payouts";
import { AdminSquaresBoard } from "@/components/squares/admin-squares-board";
import { cn } from "@/lib/utils";
import {
  assignSquareAsAdmin,
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

const MODULE_TYPE_LABELS: Record<string, string> = {
  product: "Product sale",
  squares: "Squares",
  fifty_fifty: "50/50",
  item_raffle: "Item raffle",
  wheel: "Prize wheel",
  queen_of_hearts: "Queen of Hearts",
  auction: "Auction",
  golf: "Golf outing",
};

const CHANCE_MODULE_TYPES = ["wheel", "squares", "fifty_fifty", "item_raffle", "queen_of_hearts"];

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
  searchParams: Promise<{
    espnLeague?: string;
    espnQuery?: string;
    boardSaved?: string;
    payoutsSaved?: string;
    payoutError?: string;
    scoreSaved?: string;
    scoreError?: string;
    tab?: string;
    assigned?: string;
    assignError?: string;
  }>;
}) {
  const { orgSlug, fundraiserSlug, moduleId } = await params;
  const {
    espnLeague,
    espnQuery,
    boardSaved,
    payoutsSaved,
    payoutError,
    scoreSaved,
    scoreError,
    tab: tabParam,
    assigned,
    assignError,
  } = await searchParams;
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
  const rules = resolveRules(squaresConfig);

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

  // One draw per pool: the digits are fixed for the whole game.
  const { data: draws } = isSquares
    ? await supabase
        .from("draws")
        .select("result, created_at")
        .eq("module_id", module_.id)
        .order("created_at", { ascending: true })
    : { data: [] };
  const draw = draws?.[0]?.result as { rowDigits: number[]; colDigits: number[] } | undefined;

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

  // Same test the delete policy applies (0022_modules_delete_policy.sql): any
  // transactions row against this module — offline gifts included — blocks
  // deletion, so don't offer a Delete button that can only fail.
  const { count: paymentCount } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("module_id", module_.id);
  const hasPaymentActivity = (paymentCount ?? 0) > 0;

  const claimedEntries = (entries ?? []).filter((e) => e.position != null);
  const holders = new Map(claimedEntries.map((e) => [e.position as number, e.display_name]));
  const winners = deriveWinners(squaresConfig, draw, holders);

  // Squares admin is split into tabs (?tab=). Settings is admin-only, so a
  // non-admin asking for it lands on the grid instead.
  const TABS = [
    { key: "grid", label: "Grid" },
    { key: "players", label: `Players (${claimedEntries.length})` },
    ...(isAdmin ? [{ key: "settings", label: "Settings" }] : []),
    { key: "rules", label: "Rules" },
    { key: "share", label: "Share" },
  ];
  const tab = TABS.some((t) => t.key === tabParam) ? (tabParam as string) : "grid";
  const modulePath = `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${module_.id}`;
  const tabHref = (key: string) => `${modulePath}?tab=${key}`;

  const setupSteps = [
    {
      label: "Choose the game and team colors",
      done: !!(squaresConfig.colLabel && squaresConfig.rowLabel),
      href: `${tabHref("settings")}#customize-board`,
    },
    {
      label: "Set the price per square",
      done: !!squaresConfig.pricePerSquareCents,
      href: `${tabHref("settings")}#customize-board`,
    },
    {
      label: "Review the payouts",
      done: squaresConfig.splitBps !== undefined || squaresConfig.charityBps !== undefined,
      href: `${tabHref("settings")}#payouts`,
    },
    { label: "Launch the pool", done: module_.status !== "draft", href: "#lifecycle" },
    { label: "Share the invite link", done: claimedEntries.length > 0, href: tabHref("share") },
    { label: "Lock the board and draw the numbers", done: !!draw, href: "#draw" },
  ];
  const setupDone = setupSteps.filter((step) => step.done).length;
  const paidCount = claimedEntries.filter((e) => e.transaction_id).length;
  const unpaidCount = claimedEntries.length - paidCount;
  const collectedCents = claimedEntries
    .filter((e) => e.transaction_id)
    .reduce((sum, e) => sum + (e.price_cents ?? 0), 0);

  const publicPath = `/play/${orgSlug}/${fundraiserSlug}/${module_.id}`;
  const matchupTitle =
    isSquares && (squaresConfig.rowLabel || squaresConfig.colLabel)
      ? `${squaresConfig.colLabel || "Team A"} vs. ${squaresConfig.rowLabel || "Team B"}`
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
        <Card id="lifecycle" className="scroll-mt-6">
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
                {hasPaymentActivity ? (
                  <p className="text-xs text-muted-foreground">
                    Has payment activity (offline gifts count), so it can&apos;t be
                    deleted. Create a new module to start fresh.
                  </p>
                ) : (
                  <form action={deleteModule}>
                    <input type="hidden" name="moduleId" value={module_.id} />
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                    <ConfirmSubmitButton
                      type="submit"
                      variant="outline"
                      size="sm"
                      confirmMessage={`Delete "${displayTitle}"? This can't be undone.`}
                    >
                      Delete
                    </ConfirmSubmitButton>
                  </form>
                )}
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
        <div className="flex flex-col gap-6">
          <nav className="-mb-2 flex gap-1 overflow-x-auto border-b border-border" aria-label="Pool sections">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={tabHref(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={cn(
                  "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
                  tab === t.key
                    ? "border-selection text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>

          {tab === "grid" && isAdmin && setupDone < setupSteps.length && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Set up your pool ({setupDone} of {setupSteps.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-1.5">
                  {setupSteps.map((step) => (
                    <li key={step.label}>
                      <Link
                        href={step.href}
                        className="flex items-center gap-2.5 text-sm hover:underline"
                      >
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold",
                            step.done
                              ? "border-success bg-success text-white"
                              : "border-border text-transparent",
                          )}
                          aria-hidden
                        >
                          ✓
                        </span>
                        <span className={step.done ? "text-muted-foreground line-through" : "text-foreground"}>
                          {step.label}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          {tab === "rules" && (
            <>
              <p className="text-sm text-muted-foreground">
                This is what players see on the public page. It&apos;s generated from
                your settings{isAdmin ? " — change the payouts under Settings" : ""}.
              </p>
              <RulesAndPayouts
                config={squaresConfig}
                colLabel={squaresConfig.colLabel || "Top team"}
                rowLabel={squaresConfig.rowLabel || "Side team"}
              />
            </>
          )}

          <div className="contents">
            {tab === "settings" && isAdmin && (
              <Card id="customize-board" className="scroll-mt-6">
                <CardHeader>
                  <CardTitle>Customize board</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {boardSaved && (
                    <Alert variant="success">
                      <AlertTitle>Board updated</AlertTitle>
                      <AlertDescription>
                        Now set up as {displayTitle}
                        {squaresConfig.colLabel && squaresConfig.rowLabel
                          ? ` — ${squaresConfig.colLabel} across the top, ${squaresConfig.rowLabel} down the side.`
                          : "."}
                      </AlertDescription>
                    </Alert>
                  )}
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
                      <input type="hidden" name="tab" value="settings" />
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
                                    <input type="hidden" name="colLabel" value={event.awayTeam.name} />
                                    <input type="hidden" name="rowLabel" value={event.homeTeam.name} />
                                    <input
                                      type="hidden"
                                      name="colColor"
                                      value={event.awayTeam.color ?? squaresConfig.colColor ?? "#1f2937"}
                                    />
                                    <input
                                      type="hidden"
                                      name="rowColor"
                                      value={event.homeTeam.color ?? squaresConfig.rowColor ?? "#6b7280"}
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
                        <Label htmlFor="colLabel">Top team (away)</Label>
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
                        <Label htmlFor="rowLabel">Side team (home)</Label>
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
                    <div className="flex items-start gap-2">
                      {/* Marker so the ESPN "Use this game" form, which posts
                          to the same action without this checkbox, doesn't
                          read as "unchecked" and switch the numbers off. */}
                      <input type="hidden" name="showSquareNumbersPresent" value="1" />
                      <input
                        id="showSquareNumbers"
                        name="showSquareNumbers"
                        type="checkbox"
                        defaultChecked={squaresConfig.showSquareNumbers !== false}
                        className="mt-1 h-4 w-4 accent-[var(--selection)]"
                      />
                      <Label htmlFor="showSquareNumbers" className="flex flex-col items-start gap-0.5">
                        Number each square (1–100)
                        <span className="text-xs font-normal text-muted-foreground">
                          A label on every square — it doesn&apos;t change picks or scoring.
                        </span>
                      </Label>
                    </div>
                    <Button type="submit" variant="outline">
                      Save board settings
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {tab === "grid" && (
            <Card id="board" className="scroll-mt-6">
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

                <div className="space-y-2">
                  {assigned && (
                    <Alert variant="success">
                      <AlertTitle>Square {assigned} assigned</AlertTitle>
                    </Alert>
                  )}
                  {assignError && (
                    <Alert variant="destructive">
                      <AlertTitle>Couldn&apos;t assign that square</AlertTitle>
                      <AlertDescription>{assignError}</AlertDescription>
                    </Alert>
                  )}
                  <AdminSquaresBoard
                    colLabel={squaresConfig.colLabel || "Top team"}
                    rowLabel={squaresConfig.rowLabel || "Side team"}
                    colColor={squaresConfig.colColor}
                    rowColor={squaresConfig.rowColor}
                    colDigits={draw?.colDigits}
                    rowDigits={draw?.rowDigits}
                    winners={winners
                      .filter((w) => w.position != null)
                      .map((w) => ({ position: w.position as number, label: PERIOD_SHORT_LABELS[w.period] }))}
                    showNumbers={squaresConfig.showSquareNumbers !== false}
                    entries={claimedEntries.map((e) => ({
                      id: e.id,
                      position: e.position as number,
                      name: e.display_name,
                      paid: !!e.transaction_id,
                    }))}
                    ids={{
                      orgId: org.id,
                      fundraiserId: fundraiser.id,
                      moduleId: module_.id,
                      orgSlug,
                      fundraiserSlug,
                    }}
                    priceLabel={
                      squaresConfig.pricePerSquareCents
                        ? centsToDollars(squaresConfig.pricePerSquareCents)
                        : null
                    }
                    actions={{
                      assign: assignSquareAsAdmin,
                      markPaid: markSquarePaid,
                      voidPayment: voidSquarePayment,
                      release: releaseSquare,
                    }}
                  />
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
            )}

            {tab === "settings" && isAdmin && (
              <Card id="payouts" className="scroll-mt-6">
                <CardHeader>
                  <CardTitle>Payouts</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {payoutsSaved && (
                    <Alert variant="success">
                      <AlertTitle>Payout rules saved</AlertTitle>
                    </Alert>
                  )}
                  {payoutError && (
                    <Alert variant="destructive">
                      <AlertTitle>Payout rules not saved</AlertTitle>
                      <AlertDescription>{payoutError}</AlertDescription>
                    </Alert>
                  )}
                  <PayoutRulesForm
                    key={JSON.stringify([rules, squaresConfig.pricePerSquareCents])}
                    action={updatePayoutRules}
                    orgId={org.id}
                    moduleId={module_.id}
                    orgSlug={orgSlug}
                    fundraiserSlug={fundraiserSlug}
                    pricePerSquareCents={squaresConfig.pricePerSquareCents ?? null}
                    initial={{
                      structure: rules.structure,
                      charityBps: rules.charityBps,
                      splitBps: rules.splitBps,
                    }}
                  />
                </CardContent>
              </Card>
            )}

            {tab === "grid" && (
            <Card id="draw" className="scroll-mt-6">
              <CardHeader>
                <CardTitle>Draw numbers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Assigns the row and column digits 0–9 once, server-side
                  (crypto.randomInt). The same numbers are used for the whole
                  game — every period pays the square they point to. Can&apos;t be
                  undone or redrawn.
                </p>
                {draw ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Row digits (side)</p>
                      <p className="font-mono">{draw.rowDigits.join(", ")}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Column digits (top)</p>
                      <p className="font-mono">{draw.colDigits.join(", ")}</p>
                    </div>
                  </div>
                ) : isAdmin ? (
                  <form action={drawSquares}>
                    <input type="hidden" name="orgId" value={org.id} />
                    <input type="hidden" name="moduleId" value={module_.id} />
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                    <Button type="submit" variant="outline" size="sm">
                      Draw numbers now
                    </Button>
                  </form>
                ) : (
                  <p className="text-sm text-muted-foreground">Not drawn yet.</p>
                )}
              </CardContent>
            </Card>
            )}

            {tab === "grid" && (
            <Card id="scores" className="scroll-mt-6">
              <CardHeader>
                <CardTitle>Scores &amp; winners</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {scoreSaved && (
                  <Alert variant="success">
                    <AlertTitle>Score saved</AlertTitle>
                  </Alert>
                )}
                {scoreError && (
                  <Alert variant="destructive">
                    <AlertTitle>Score not saved</AlertTitle>
                    <AlertDescription>{scoreError}</AlertDescription>
                  </Alert>
                )}
                {isAdmin &&
                  (draw ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Enter the score at the end of each period. The winning
                        square is where {squaresConfig.colLabel || "the top team"}&apos;s
                        last digit (column) meets{" "}
                        {squaresConfig.rowLabel || "the side team"}&apos;s (row).
                        Saving a period again corrects it.
                      </p>
                      {rules.periods.map((period) => {
                        const saved = squaresConfig.scores?.[period];
                        return (
                          <form
                            key={`${period}:${saved?.col ?? ""}:${saved?.row ?? ""}`}
                            action={saveSquaresScore}
                            className="flex flex-wrap items-end gap-3"
                          >
                            <input type="hidden" name="orgId" value={org.id} />
                            <input type="hidden" name="moduleId" value={module_.id} />
                            <input type="hidden" name="orgSlug" value={orgSlug} />
                            <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                            <input type="hidden" name="period" value={period} />
                            <span className="w-full text-sm font-medium text-foreground sm:w-52">
                              {PERIOD_LABELS[period]}
                            </span>
                            <div className="space-y-1">
                              <Label htmlFor={`col_${period}`} className="text-xs">
                                {squaresConfig.colLabel || "Top team"}
                              </Label>
                              <Input
                                id={`col_${period}`}
                                name="colScore"
                                type="number"
                                min="0"
                                max="999"
                                required
                                defaultValue={saved?.col ?? ""}
                                className="w-24"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`row_${period}`} className="text-xs">
                                {squaresConfig.rowLabel || "Side team"}
                              </Label>
                              <Input
                                id={`row_${period}`}
                                name="rowScore"
                                type="number"
                                min="0"
                                max="999"
                                required
                                defaultValue={saved?.row ?? ""}
                                className="w-24"
                              />
                            </div>
                            <Button type="submit" variant="outline" size="sm">
                              {saved ? "Update" : "Save"}
                            </Button>
                          </form>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Draw the numbers first — scores can be entered once the
                      board&apos;s digits are set.
                    </p>
                  ))}
                <WinnersTable
                  winners={winners}
                  colLabel={squaresConfig.colLabel || "Top team"}
                  rowLabel={squaresConfig.rowLabel || "Side team"}
                />
              </CardContent>
            </Card>
            )}

            {tab === "players" && (
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
                          <TableCell className="font-mono">{(entry.position as number) + 1}</TableCell>
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
            )}

            {tab === "players" && activity && activity.length > 0 && (
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

          <div className="contents">
            {tab === "settings" && isAdmin && (
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

            {tab === "share" && (
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
                  <span>
                    {PAYOUT_STRUCTURE_OPTIONS.find((o) => o.value === rules.structure)?.label}
                  </span>
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
                  <span>{draw ? "Yes" : "No"}</span>
                </div>
              </CardContent>
            </Card>
            )}
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
      return `Square #${Number(a.position) + 1} marked paid${
        typeof a.amount_cents === "number" ? ` (${centsToDollars(a.amount_cents)})` : ""
      }`;
    case "square.payment_voided":
      return `Payment voided for square #${Number(a.position) + 1}`;
    case "square.released":
      return `Square #${Number(a.position) + 1} released (was ${a.display_name})`;
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
