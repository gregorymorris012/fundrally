import { createBrowserClient } from "@supabase/ssr";

// flowType: "implicit" (default is "pkce") — PKCE stores a code_verifier
// cookie on whichever browser calls signInWithOtp, and the magic-link
// callback can only complete on that same browser. Email links routinely
// get opened from a different device/browser (mail app, phone vs. desktop),
// which silently fails the PKCE exchange and bounces back to sign-in with
// no visible error. Implicit flow puts the session directly in the
// redirect URL's hash fragment instead, so it works cross-device — see
// src/app/auth/callback/page.tsx, which has to be a client page (not a
// route handler) because hash fragments never reach the server.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: "implicit" } },
  );
}
