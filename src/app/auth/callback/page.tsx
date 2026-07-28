"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Client page, not a route handler: implicit flow puts the session in the
// URL's hash fragment (#access_token=...), which never reaches the server
// — see the flowType comment in lib/supabase/client.ts. createClient()'s
// detectSessionInUrl (default true) parses that hash on init; getSession()
// awaits that in-flight processing before resolving.
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace("/");
      } else {
        router.replace("/auth/sign-in?error=auth_callback_failed");
      }
    });
  }, [router]);

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  );
}
