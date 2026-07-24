import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
        <Logo size={160} />
        <Link href="/auth/sign-in" className={buttonVariants()}>
          Sign in
        </Link>
      </div>
    );
  }

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, slug)")
    .eq("user_id", user.id);

  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col items-center gap-4 p-6">
      <Logo size={96} />
      <p className="text-sm text-muted-foreground">
        Signed in as {user.email ?? user.phone}.
      </p>

      <div className="w-full space-y-2">
        {memberships?.length ? (
          memberships.map((m) => {
            const org = Array.isArray(m.organizations)
              ? m.organizations[0]
              : m.organizations;
            if (!org) return null;
            return (
              <Link
                key={org.id}
                href={`/org/${org.slug}`}
                className={buttonVariants({ variant: "outline", className: "w-full justify-start" })}
              >
                {org.name}
              </Link>
            );
          })
        ) : (
          <p className="text-sm text-muted-foreground">No organizations yet.</p>
        )}
      </div>

      <Link href="/org/new" className={buttonVariants()}>
        New organization
      </Link>
    </div>
  );
}
