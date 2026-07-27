import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, TriangleAlert, CircleX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createFundraiser } from "@/lib/fundraisers";
import { refundTransaction } from "@/lib/payments/refund";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Logo } from "@/components/logo";

const fundraiserStatusVariant = {
  active: "success",
  draft: "secondary",
  closed: "outline",
} as const;

const transactionStatusVariant = {
  succeeded: "success",
  failed: "destructive",
  refunded: "secondary",
  disputed: "warning",
} as const;

export default async function OrgDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ stripe_connected?: string; stripe_error?: string }>;
}) {
  const { orgSlug } = await params;
  const { stripe_connected, stripe_error } = await searchParams;
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

  const isAdmin = membership.role === "owner" || membership.role === "admin";

  const { data: fundraisers } = await supabase
    .from("fundraisers")
    .select("id, title, slug, status")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false });

  const { data: transactions } = await supabase
    .from("transactions")
    .select("id, kind, gross_cents, currency, status, created_at")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {org.name}
          </h1>
        </div>
        <Link
          href="/"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Switch organization
        </Link>
      </div>

      {stripe_connected && (
        <Alert variant="success">
          <CircleCheck />
          <AlertTitle>Stripe account connected.</AlertTitle>
        </Alert>
      )}
      {stripe_error && (
        <Alert variant="destructive">
          <CircleX />
          <AlertTitle>Stripe connection failed ({stripe_error}).</AlertTitle>
          <AlertDescription>Try again.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {org.charges_enabled ? (
            <Alert variant="success">
              <CircleCheck />
              <AlertTitle>Ready to accept charges.</AlertTitle>
              <AlertDescription>
                Stripe is connected for {org.name}.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>Stripe isn&apos;t connected yet.</AlertTitle>
              <AlertDescription>
                Connect Stripe before any fundraiser can accept payments.
              </AlertDescription>
            </Alert>
          )}
          {isAdmin && !org.charges_enabled && (
            <a
              className={buttonVariants()}
              href={`/org/${org.slug}/stripe/connect`}
            >
              Connect Stripe
            </a>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>New fundraiser</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createFundraiser} className="space-y-3">
              <input type="hidden" name="orgId" value={org.id} />
              <input type="hidden" name="orgSlug" value={org.slug} />
              <div className="space-y-1.5">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" required />
              </div>
              <Button type="submit">Create</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Fundraisers</CardTitle>
        </CardHeader>
        <CardContent>
          {fundraisers?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fundraisers.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.title}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          fundraiserStatusVariant[
                            f.status as keyof typeof fundraiserStatusVariant
                          ]
                        }
                      >
                        {f.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Link
                        href={`/org/${org.slug}/fundraisers/${f.slug}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        Manage
                      </Link>
                      <Link
                        href={`/donate/${org.slug}/${f.slug}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        Donate page
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No fundraisers yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Badge variant="outline">{t.kind}</Badge>
                    </TableCell>
                    <TableCell className="font-mono">
                      {(t.gross_cents / 100).toFixed(2)} {t.currency.toUpperCase()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          transactionStatusVariant[
                            t.status as keyof typeof transactionStatusVariant
                          ]
                        }
                      >
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {isAdmin && t.kind === "donation" && t.status === "succeeded" && (
                        <form action={refundTransaction.bind(null, t.id)}>
                          <Button type="submit" variant="outline" size="sm">
                            Refund
                          </Button>
                        </form>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
