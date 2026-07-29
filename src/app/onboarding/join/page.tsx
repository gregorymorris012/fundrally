import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/lib/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/logo";

// Placeholder: there's no way yet for a user to join an existing
// organization as a member — create_organization() always makes the
// creator an owner of a brand-new org. Real join-by-code needs a new
// invite system (SECURITY DEFINER RPC, membership rows), not just a
// flow restyle. See src/lib/organizations.ts for the org-creation
// bootstrapping pattern this would follow.
export default async function OnboardingJoinPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  return (
    <div className="relative mx-auto flex min-h-svh max-w-sm flex-col items-center justify-center gap-6 p-6 text-center">
      <form action={signOutAction} className="absolute top-4 right-4">
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>
      <Logo size={150} />
      <Sparkles className="size-8 text-primary" />
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Coming soon
        </h1>
        <p className="text-muted-foreground">
          Linking to an existing fundraiser isn&apos;t ready yet. For now,
          start a new fundraiser instead.
        </p>
      </div>
      <div className="flex gap-2">
        <Link href="/onboarding" className={buttonVariants({ variant: "outline" })}>
          Back
        </Link>
        <Link href="/onboarding/organization" className={buttonVariants()}>
          Start a fundraiser
        </Link>
      </div>
    </div>
  );
}
