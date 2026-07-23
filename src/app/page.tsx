import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      {user ? (
        <p className="text-sm text-muted-foreground">
          Signed in as {user.email ?? user.phone}.
        </p>
      ) : (
        <Link href="/auth/sign-in" className={buttonVariants()}>
          Sign in
        </Link>
      )}
    </div>
  );
}
