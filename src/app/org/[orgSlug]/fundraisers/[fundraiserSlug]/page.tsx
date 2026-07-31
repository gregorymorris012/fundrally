import Link from "next/link";
import { notFound } from "next/navigation";
import { LineChart, Dices, HandCoins } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { updateFundraiserGoal } from "@/lib/fundraisers";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const fundraiserStatusVariant = {
  active: "success",
  draft: "secondary",
  closed: "outline",
} as const;

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// Landing page for a single fundraiser: goal progress up top, then three
// options leading to the actual work (financial dashboard, modules,
// offline donations) — each of those used to be crammed onto this one
// page, which got overwhelming fast. Keeping it a real landing page
// instead of one long scroll.
export default async function FundraiserLandingPage({
  params,
}: {
  params: Promise<{ orgSlug: string; fundraiserSlug: string }>;
}) {
  const { orgSlug, fundraiserSlug } = await params;
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

  const { data: orgFundraisers } = await supabase
    .from("fundraisers")
    .select("id, title, slug")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false });

  const { data: allTimeRows } = await supabase
    .from("transactions")
    .select("gross_cents")
    .eq("fundraiser_id", fundraiser.id)
    .eq("status", "succeeded");
  const totalRaisedCents = (allTimeRows ?? []).reduce(
    (sum, r) => sum + r.gross_cents,
    0,
  );

  const { count: moduleCount } = await supabase
    .from("modules")
    .select("id", { count: "exact", head: true })
    .eq("fundraiser_id", fundraiser.id);
  const { count: activeModuleCount } = await supabase
    .from("modules")
    .select("id", { count: "exact", head: true })
    .eq("fundraiser_id", fundraiser.id)
    .eq("status", "active");

  const { count: offlineGiftCount } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("fundraiser_id", fundraiser.id)
    .eq("status", "succeeded")
    .neq("method", "stripe");

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

          {isAdmin && (
            <form
              action={updateFundraiserGoal}
              className="flex items-end gap-2 border-t pt-3"
            >
              <input type="hidden" name="fundraiserId" value={fundraiser.id} />
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="goal">Goal (USD)</Label>
                <Input
                  id="goal"
                  name="goal"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={
                    fundraiser.goal_amount_cents
                      ? (fundraiser.goal_amount_cents / 100).toFixed(2)
                      : ""
                  }
                  placeholder="No goal set"
                />
              </div>
              <Button type="submit" variant="outline">
                Update goal
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3">
        <Link href={`/org/${orgSlug}/fundraisers/${fundraiserSlug}/dashboard`}>
          <Card className="cursor-pointer transition-colors hover:bg-muted">
            <CardHeader className="flex items-center gap-4">
              <LineChart className="size-8 shrink-0 text-primary" />
              <div>
                <CardTitle>Financial Dashboard</CardTitle>
                <CardDescription>
                  Date range, breakdowns by module and payment method,
                  activity over time, and the full transaction list.
                </CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>

        <Link href={`/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules`}>
          <Card className="cursor-pointer transition-colors hover:bg-muted">
            <CardHeader className="flex items-center gap-4">
              <Dices className="size-8 shrink-0 text-primary" />
              <div>
                <CardTitle>Manage Fundraising Modules</CardTitle>
                <CardDescription>
                  {moduleCount ?? 0} module{moduleCount === 1 ? "" : "s"}{" "}
                  ({activeModuleCount ?? 0} active) — create, launch, and
                  manage mini-fundraisers under this campaign.
                </CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>

        <Link href={`/org/${orgSlug}/fundraisers/${fundraiserSlug}/offline-gifts`}>
          <Card className="cursor-pointer transition-colors hover:bg-muted">
            <CardHeader className="flex items-center gap-4">
              <HandCoins className="size-8 shrink-0 text-primary" />
              <div>
                <CardTitle>Manage Offline Donations</CardTitle>
                <CardDescription>
                  {offlineGiftCount ?? 0} logged — record cash, check, and
                  in-kind gifts collected outside the app.
                </CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
