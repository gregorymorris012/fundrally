import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Users, LayoutDashboard } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Logo } from "@/components/logo";

export default async function OnboardingIntentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  return (
    <div className="relative mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-8 p-6 text-center">
      <form action={signOutAction} className="absolute top-4 right-4">
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>
      <Logo size={150} />
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-bold text-foreground">
          What would you like to do?
        </h1>
      </div>

      <div className="grid w-full gap-3">
        <Link href="/onboarding/organization">
          <Card className="cursor-pointer text-left transition-colors hover:bg-muted">
            <CardHeader className="flex items-center gap-4">
              <Building2 className="size-8 shrink-0 text-primary" />
              <div>
                <CardTitle>Start a Fundraiser for My Organization</CardTitle>
                <CardDescription>
                  Set up your organization and launch your first fundraiser.
                </CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/onboarding/join">
          <Card className="cursor-pointer text-left transition-colors hover:bg-muted">
            <CardHeader className="flex items-center gap-4">
              <Users className="size-8 shrink-0 text-primary" />
              <div>
                <CardTitle>Raise Funds for Another Organization</CardTitle>
                <CardDescription>
                  Join an existing team or organization&apos;s fundraiser.
                </CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>

        {/* Escape hatch to "/" (the plain org switcher) for anyone who
            already has an org but ended up back here — there's no
            dedicated dashboard/home yet, so this is the stopgap until
            one exists. */}
        <Link href="/">
          <Card className="cursor-pointer text-left transition-colors hover:bg-muted">
            <CardHeader className="flex items-center gap-4">
              <LayoutDashboard className="size-8 shrink-0 text-primary" />
              <div>
                <CardTitle>Manage My Fundraisers</CardTitle>
                <CardDescription>
                  Go to an organization or fundraiser you&apos;ve already set up.
                </CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
