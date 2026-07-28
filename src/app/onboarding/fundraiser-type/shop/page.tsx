import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createShopFundraiserOnboardingAction } from "@/lib/onboarding";
import { signOutAction } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/logo";

export default async function OnboardingShopFundraiserPage({
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

  return (
    <div className="relative mx-auto flex min-h-svh max-w-sm flex-col items-center justify-center gap-6 p-6">
      <form action={signOutAction} className="absolute top-4 right-4">
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>
      <Logo size={120} />
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Name your fundraiser</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createShopFundraiserOnboardingAction} className="space-y-3">
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={org.slug} />
            <div className="space-y-1.5">
              <Label htmlFor="title">Fundraiser title</Label>
              <Input
                id="title"
                name="title"
                placeholder="Spring Bake Sale"
                required
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full">
              Create fundraiser
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
