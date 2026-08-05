import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const payoutStatusVariant = {
  paid: "success",
  in_transit: "secondary",
  pending: "secondary",
  failed: "destructive",
  canceled: "outline",
} as const;

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// Phase 3 ("Reporting + payouts") — a read-only mirror of Stripe's own
// payout objects (db/schema/payouts.ts), written only by
// src/lib/payments/webhook-handlers.ts. Org-scoped, not fundraiser-scoped:
// a Stripe Connect account's balance pools money across every fundraiser
// under it, so a payout can't be cleanly attributed to just one.
export default async function PayoutsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, charges_enabled")
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

  const { data: payouts } = await supabase
    .from("payouts")
    .select("id, stripe_payout_id, amount_cents, status, arrival_date, failure_message")
    .eq("org_id", org.id)
    .order("arrival_date", { ascending: false })
    .limit(50);

  const { data: allTimeRows } = await supabase
    .from("transactions")
    .select("net_cents")
    .eq("org_id", org.id)
    .eq("status", "succeeded");
  const totalNetCents = (allTimeRows ?? []).reduce(
    (sum, r) => sum + r.net_cents,
    0,
  );
  const totalPaidOutCents = (payouts ?? [])
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount_cents, 0);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Payouts
        </h1>
        <Link href={`/org/${orgSlug}`} className="text-sm text-muted-foreground underline">
          Back to {org.name}
        </Link>
      </div>

      {!org.charges_enabled && (
        <Alert variant="warning">
          <AlertTitle>Stripe isn&apos;t connected yet.</AlertTitle>
          <AlertDescription>
            Payouts come directly from Stripe once connected — nothing to
            show here until then.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Net raised (all-time)</span>
            <span className="font-mono">{centsToDollars(totalNetCents)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Paid out to your bank</span>
            <span className="font-mono">{centsToDollars(totalPaidOutCents)}</span>
          </div>
          <p className="pt-1 text-xs text-muted-foreground">
            These won&apos;t match exactly — Stripe&apos;s own processing
            fee (roughly 2.9% + 30¢ per charge) comes out of your Stripe
            balance directly and isn&apos;t reflected in the net-raised
            figure above. That gap is expected, not missing money.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payout history</CardTitle>
        </CardHeader>
        <CardContent>
          {payouts?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arrival date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-muted-foreground">
                      {p.arrival_date
                        ? new Date(p.arrival_date).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          payoutStatusVariant[
                            p.status as keyof typeof payoutStatusVariant
                          ]
                        }
                      >
                        {p.status.replace("_", " ")}
                      </Badge>
                      {p.failure_message && (
                        <p className="mt-1 text-xs text-destructive">
                          {p.failure_message}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {centsToDollars(p.amount_cents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              No payouts yet. Stripe pays out on its own schedule once your
              balance has money in it — nothing to trigger here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
