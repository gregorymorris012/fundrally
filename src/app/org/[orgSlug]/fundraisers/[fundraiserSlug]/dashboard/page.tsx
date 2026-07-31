import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

// Split out of the fundraiser landing page: date range, breakdowns,
// activity over time, and the transaction list — reads ONLY from
// `transactions` (CLAUDE.md: "single source of financial truth... nothing
// reads module tables for money figures").
export default async function FinancialDashboardPage({
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

  const { data: fundraiser } = await supabase
    .from("fundraisers")
    .select("id, title")
    .eq("org_id", org.id)
    .eq("slug", fundraiserSlug)
    .maybeSingle();
  if (!fundraiser) notFound();

  // Date filtering/grouping uses entered_at when present, falling back to
  // created_at — a manual gift's real-world "date received" is what a
  // time series and date-range filter should reflect. Postgrest can't
  // express that coalesce in a .gte/.lte filter, so filtering/grouping
  // happens in JS against this fundraiser's (small, demo-scale)
  // succeeded-transaction set rather than via a DB-side date filter.
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

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Financial Dashboard
        </h1>
        <Link
          href={`/org/${orgSlug}/fundraisers/${fundraiserSlug}`}
          className="text-sm text-muted-foreground underline"
        >
          Back to {fundraiser.title}
        </Link>
      </div>

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
                href={`/org/${orgSlug}/fundraisers/${fundraiserSlug}/dashboard`}
                className={buttonVariants({ variant: "ghost" })}
              >
                Clear
              </Link>
            )}
          </form>
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
    </div>
  );
}
