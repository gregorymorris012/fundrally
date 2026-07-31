import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createModule } from "@/lib/modules";
import { addOfflineGift } from "@/lib/payments/offline-gift";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fundraiserStatusVariant = {
  active: "success",
  draft: "secondary",
  closed: "outline",
} as const;

const MODULE_TYPE_LABELS: Record<string, string> = {
  product: "Product sale",
  squares: "Squares",
  fifty_fifty: "50/50",
  item_raffle: "Item raffle",
  wheel: "Prize wheel",
  auction: "Auction",
  golf: "Golf outing",
};

const METHOD_LABELS: Record<string, string> = {
  stripe: "Card (Stripe)",
  cash: "Cash",
  check: "Check",
  in_kind: "In-kind",
  other: "Other",
};

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default async function FundraiserAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; fundraiserSlug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { orgSlug, fundraiserSlug } = await params;
  const { from, to } = await searchParams;
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
    .select("id, title, slug, status, goal_amount_cents")
    .eq("org_id", org.id)
    .eq("slug", fundraiserSlug)
    .maybeSingle();
  if (!fundraiser) notFound();

  // Fundraiser switcher: every fundraiser in this org, for a quick link list
  // at the top of the dashboard.
  const { data: orgFundraisers } = await supabase
    .from("fundraisers")
    .select("id, title, slug")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false });

  // Goal thermometer is always all-time, regardless of the date filter
  // below — a campaign goal shouldn't look partial just because someone
  // narrowed the date range for the activity breakdowns.
  const { data: allTimeRows } = await supabase
    .from("transactions")
    .select("gross_cents")
    .eq("fundraiser_id", fundraiser.id)
    .eq("status", "succeeded");
  const totalRaisedCents = (allTimeRows ?? []).reduce(
    (sum, r) => sum + r.gross_cents,
    0,
  );

  // Everything below (breakdowns, list, time series) reads ONLY from
  // `transactions` — CLAUDE.md: "transactions is the single source of
  // financial truth... nothing reads module tables for money figures".
  //
  // Date filtering/grouping uses entered_at when present, falling back to
  // created_at — a manual gift's real-world "date received" is what a
  // time series and date-range filter should reflect, not the moment a
  // staffer happened to type it in (which is all created_at means for a
  // manual row). Stripe rows have no entered_at, so created_at is exactly
  // right for them. Postgrest can't express that coalesce in a .gte/.lte
  // filter, so filtering/grouping happens in JS against this org's
  // (small, demo-scale) succeeded-transaction set rather than via a DB-side
  // date filter.
  const { data: ledgerRows } = await supabase
    .from("transactions")
    .select(
      "id, kind, method, gross_cents, module_id, created_at, entered_at, participants(display_name)",
    )
    .eq("fundraiser_id", fundraiser.id)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(200);
  const displayDate = (t: { entered_at: string | null; created_at: string }) =>
    t.entered_at ?? t.created_at;
  const transactionsInRange = (ledgerRows ?? []).filter((t) => {
    const day = displayDate(t).slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });

  const { data: fundraiserModules } = await supabase
    .from("modules")
    .select("id, type, status")
    .eq("fundraiser_id", fundraiser.id)
    .order("created_at", { ascending: true });

  const byModuleCents = new Map<string, number>();
  const byMethodCents = new Map<string, number>();
  const byDayCents = new Map<string, number>();
  for (const t of transactionsInRange) {
    const moduleKey = t.module_id ?? "general";
    byModuleCents.set(
      moduleKey,
      (byModuleCents.get(moduleKey) ?? 0) + t.gross_cents,
    );
    byMethodCents.set(
      t.method,
      (byMethodCents.get(t.method) ?? 0) + t.gross_cents,
    );
    const day = displayDate(t).slice(0, 10);
    byDayCents.set(day, (byDayCents.get(day) ?? 0) + t.gross_cents);
  }
  const dayEntries = [...byDayCents.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const maxDayCents = Math.max(1, ...dayEntries.map(([, c]) => c));

  // Which chance-based module types this org has enabled (CLAUDE.md
  // "Current deviations from the build spec") — drives which types show
  // up as creatable in the "Create module" picker below. Product is
  // always creatable; it predates module_availability entirely.
  const { data: availabilityRows } = await supabase
    .from("module_availability")
    .select("module_type, enabled")
    .eq("org_id", org.id)
    .eq("enabled", true);
  const enabledChanceTypes = new Set(
    (availabilityRows ?? []).map((r) => r.module_type),
  );
  const hasProductModule = (fundraiserModules ?? []).some(
    (m) => m.type === "product",
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {fundraiser.title}
          </h1>
          <Badge
            variant={
              fundraiserStatusVariant[
                fundraiser.status as keyof typeof fundraiserStatusVariant
              ]
            }
          >
            {fundraiser.status}
          </Badge>
        </div>
        <Link href={`/org/${orgSlug}`} className="text-sm text-muted-foreground underline">
          Back to organization
        </Link>
      </div>

      {orgFundraisers && orgFundraisers.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {orgFundraisers.map((f) => (
            <Link
              key={f.id}
              href={`/org/${orgSlug}/fundraisers/${f.slug}`}
              className={buttonVariants({
                variant: f.slug === fundraiserSlug ? "default" : "outline",
                size: "sm",
              })}
            >
              {f.title}
            </Link>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Goal progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-2xl font-bold text-foreground">
              {centsToDollars(totalRaisedCents)}
            </span>
            <span className="text-sm text-muted-foreground">
              {fundraiser.goal_amount_cents
                ? `of ${centsToDollars(fundraiser.goal_amount_cents)} goal (all-time)`
                : "raised all-time — no goal set"}
            </span>
          </div>
          {fundraiser.goal_amount_cents ? (
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    (totalRaisedCents / fundraiser.goal_amount_cents) * 100,
                  )}%`,
                }}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Date range</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={from} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={to} />
            </div>
            <Button type="submit" variant="outline">
              Apply
            </Button>
            {(from || to) && (
              <Link
                href={`/org/${orgSlug}/fundraisers/${fundraiserSlug}`}
                className={buttonVariants({ variant: "ghost" })}
              >
                Clear
              </Link>
            )}
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Applies to the breakdowns, activity, and transaction list below —
            not to the all-time goal total above.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Breakdown by module</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {fundraiserModules?.length ? (
            fundraiserModules.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <span>
                  {MODULE_TYPE_LABELS[m.type] ?? m.type}{" "}
                  <span className="text-muted-foreground">({m.status})</span>
                </span>
                <span className="font-mono">
                  {centsToDollars(byModuleCents.get(m.id) ?? 0)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No modules yet.</p>
          )}
          {byModuleCents.get("general") ? (
            <div className="flex items-center justify-between text-sm">
              <span>General (no module)</span>
              <span className="font-mono">
                {centsToDollars(byModuleCents.get("general") ?? 0)}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Breakdown by payment method</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {byMethodCents.size ? (
            [...byMethodCents.entries()].map(([method, cents]) => (
              <div key={method} className="flex items-center justify-between text-sm">
                <span>{METHOD_LABELS[method] ?? method}</span>
                <span className="font-mono">{centsToDollars(cents)}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No activity in this range.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity over time</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {dayEntries.length ? (
            dayEntries.map(([day, cents]) => (
              <div key={day} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 text-muted-foreground">{day}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(cents / maxDayCents) * 100}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right font-mono text-xs">
                  {centsToDollars(cents)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No activity in this range.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {transactionsInRange.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Donor</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactionsInRange.map((t) => {
                  const participant = Array.isArray(t.participants)
                    ? t.participants[0]
                    : t.participants;
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="text-muted-foreground">
                        {new Date(displayDate(t)).toLocaleDateString()}
                      </TableCell>
                      <TableCell>{participant?.display_name ?? "Guest"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {METHOD_LABELS[t.method] ?? t.method}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {centsToDollars(t.gross_cents)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              No transactions in this range.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {fundraiserModules?.length ? (
            fundraiserModules.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <span>
                  {MODULE_TYPE_LABELS[m.type] ?? m.type}{" "}
                  <span className="text-muted-foreground">({m.status})</span>
                </span>
                <Link
                  href={`/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${m.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Manage
                </Link>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No modules yet.</p>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Create module</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createModule} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="orgId" value={org.id} />
              <input type="hidden" name="fundraiserId" value={fundraiser.id} />
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
              <div className="space-y-1.5">
                <Label htmlFor="type">Type</Label>
                <select
                  id="type"
                  name="type"
                  required
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {!hasProductModule && <option value="product">Product sale</option>}
                  {[...enabledChanceTypes].map((type) => (
                    <option key={type} value={type}>
                      {MODULE_TYPE_LABELS[type] ?? type} (demo mode)
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">Create</Button>
            </form>
            {enabledChanceTypes.size === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Chance-based module types (squares, 50/50, item raffle, prize
                wheel) show up here once an admin enables them for this
                organization on the org dashboard.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Add offline gift</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={addOfflineGift} className="space-y-3">
              <input type="hidden" name="orgId" value={org.id} />
              <input type="hidden" name="fundraiserId" value={fundraiser.id} />
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
              <div className="space-y-1.5">
                <Label htmlFor="donorName">Donor name</Label>
                <Input id="donorName" name="donorName" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Amount (USD)</Label>
                  <Input
                    id="amount"
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="method">Method</Label>
                  <select
                    id="method"
                    name="method"
                    required
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="in_kind">In-kind</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="receivedAt">Date received</Label>
                  <Input id="receivedAt" name="receivedAt" type="date" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="moduleId">Module (optional)</Label>
                  <select
                    id="moduleId"
                    name="moduleId"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="">General (no module)</option>
                    {fundraiserModules?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {MODULE_TYPE_LABELS[m.type] ?? m.type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reference">Note (optional)</Label>
                <Input id="reference" name="reference" placeholder="Check #, event note, etc." />
              </div>
              <Button type="submit">Add gift</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
