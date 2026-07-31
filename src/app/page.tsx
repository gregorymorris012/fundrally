import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/lib/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-8 p-6 text-center">
        <Logo size={210} />
        <div className="max-w-sm space-y-3">
          <h1 className="font-heading text-4xl font-bold text-foreground">
            Start Fundraising the Right Way
          </h1>
          <p className="text-muted-foreground">
            Auctions, raffles, shop sales, and more — all in one place, built
            for teams and communities.
          </p>
        </div>
        <Link href="/auth/sign-in" className={buttonVariants({ size: "lg" })}>
          Get started
        </Link>
      </div>
    );
  }

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, slug)")
    .eq("user_id", user.id);

  // First-run: send brand-new users through the onboarding wizard instead
  // of a bare "No organizations yet." Returning users with at least one
  // org keep the plain switcher below.
  if (!memberships?.length) redirect("/onboarding");

  // Deliberately a smarter link, not an auto-redirect: an org with exactly
  // one fundraiser sends its switcher link straight to that fundraiser's
  // dashboard instead of the org shell page, so partners land on the
  // dashboard in one click rather than an emptier-feeling org page. An
  // unconditional redirect here would recreate the earlier
  // onboarding redirect-loop bug — the org page's "Switch organization"
  // link comes right back to "/", which would just bounce straight back
  // into the dashboard with nowhere to actually reach the org switcher.
  const orgIds = memberships
    .map((m) => {
      const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
      return org?.id;
    })
    .filter((id): id is string => Boolean(id));
  const { data: allFundraisers } = orgIds.length
    ? await supabase.from("fundraisers").select("org_id, slug").in("org_id", orgIds)
    : { data: [] };
  const fundraisersByOrg = new Map<string, { slug: string }[]>();
  for (const f of allFundraisers ?? []) {
    fundraisersByOrg.set(f.org_id, [...(fundraisersByOrg.get(f.org_id) ?? []), f]);
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col items-center gap-4 p-6">
      <Logo size={144} />
      <p className="text-sm text-muted-foreground">
        Signed in as {user.email ?? user.phone}.
      </p>
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>

      <div className="w-full space-y-2">
        {memberships.map((m) => {
          const org = Array.isArray(m.organizations)
            ? m.organizations[0]
            : m.organizations;
          if (!org) return null;
          const orgFundraisers = fundraisersByOrg.get(org.id);
          const href =
            orgFundraisers?.length === 1
              ? `/org/${org.slug}/fundraisers/${orgFundraisers[0].slug}`
              : `/org/${org.slug}`;
          return (
            <Link
              key={org.id}
              href={href}
              className={buttonVariants({ variant: "outline", className: "w-full justify-start" })}
            >
              {org.name}
            </Link>
          );
        })}
      </div>

      <Link href="/org/new" className={buttonVariants()}>
        New organization
      </Link>
    </div>
  );
}
