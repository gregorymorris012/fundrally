import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ShoppingBag,
  Gavel,
  Ticket,
  Percent,
  Disc3,
  Grid3x3,
  Flag,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/logo";

// Icons for every module type in the build spec (db/schema/modules.ts),
// so this screen previews the full roadmap — but only `product` is
// implemented (Phase 2). The chance-based types (wheel, squares,
// fifty_fifty, item_raffle) additionally can't go live before Phase 4's
// compliance gating per the build spec's module_availability table, so
// they stay non-interactive here regardless of build order.
const FUNDRAISER_TYPES = [
  {
    type: "product",
    label: "Shop / Product Sale",
    icon: ShoppingBag,
    enabled: true,
  },
  { type: "auction", label: "Auction", icon: Gavel, enabled: false },
  { type: "item_raffle", label: "Raffle", icon: Ticket, enabled: false },
  { type: "fifty_fifty", label: "50/50", icon: Percent, enabled: false },
  { type: "wheel", label: "Prize Wheel", icon: Disc3, enabled: false },
  { type: "squares", label: "Squares", icon: Grid3x3, enabled: false },
  { type: "golf", label: "Golf Outing", icon: Flag, enabled: false },
] as const;

export default async function OnboardingFundraiserTypePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: orgSlug } = await searchParams;
  if (!orgSlug) redirect("/onboarding");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug")
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

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-8 p-6 text-center">
      <Logo size={80} />
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-bold text-foreground">
          What type of fundraiser would you like to start?
        </h1>
        <p className="text-muted-foreground">for {org.name}</p>
      </div>

      <div className="grid w-full grid-cols-2 gap-3">
        {FUNDRAISER_TYPES.map(({ type, label, icon: Icon, enabled }) => {
          const content = (
            <Card
              className={
                enabled
                  ? "cursor-pointer items-center text-center transition-colors hover:bg-muted"
                  : "items-center text-center opacity-50"
              }
            >
              <CardHeader className="flex flex-col items-center gap-2">
                <Icon className="size-8 text-primary" />
                <CardTitle className="text-sm">{label}</CardTitle>
                {!enabled && <Badge variant="secondary">Coming soon</Badge>}
              </CardHeader>
            </Card>
          );

          return enabled ? (
            <Link
              key={type}
              href={`/onboarding/fundraiser-type/shop?org=${org.slug}`}
            >
              {content}
            </Link>
          ) : (
            <div key={type}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
