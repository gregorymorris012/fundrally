import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createFundraiser } from "@/lib/fundraisers";
import { refundTransaction } from "@/lib/payments/refund";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
      <h1 className="text-2xl font-semibold">{org.name}</h1>

      {stripe_connected && (
        <p className="text-sm text-emerald-600">Stripe account connected.</p>
      )}
      {stripe_error && (
        <p className="text-sm text-destructive">
          Stripe connection failed ({stripe_error}). Try again.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {org.charges_enabled
              ? "Stripe is connected and able to accept charges."
              : "Connect Stripe before any fundraiser can accept payments."}
          </p>
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
              <div className="space-y-1.5">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" name="slug" required pattern="[a-z0-9-]+" />
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
        <CardContent className="space-y-2">
          {fundraisers?.length ? (
            fundraisers.map((f) => (
              <div key={f.id} className="flex items-center justify-between">
                <span>
                  {f.title} <span className="text-muted-foreground">({f.status})</span>
                </span>
                <div className="flex gap-2">
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
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No fundraisers yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {transactions?.length ? (
            transactions.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm">
                <span>
                  {t.kind} — {(t.gross_cents / 100).toFixed(2)} {t.currency.toUpperCase()}{" "}
                  <span className="text-muted-foreground">({t.status})</span>
                </span>
                {isAdmin && t.kind === "donation" && t.status === "succeeded" && (
                  <form action={refundTransaction.bind(null, t.id)}>
                    <Button type="submit" variant="outline" size="sm">
                      Refund
                    </Button>
                  </form>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
