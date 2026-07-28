"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

// One-click sign-in for local dev and, when explicitly opted into via
// NEXT_PUBLIC_ENABLE_TEST_LOGIN, a shared Preview deployment — never
// Production (see next.config.ts / Vercel env scoping). Originally built
// against phone test_otp numbers, but that only exists in the local
// Supabase CLI's config.toml — the hosted project has phone auth disabled
// entirely and no equivalent. This version instead uses the Admin API to
// generate a magic-link token server-side (service role) and immediately
// verifies it — a real session through real Supabase Auth, same as any
// other sign-in, just without an email ever actually being sent, so it
// doesn't touch the 2/hour default-mailer rate limit either.
const TEST_LOGIN_EMAIL = "test-login@fundrally.test";
const TEST_LOGIN_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_TEST_LOGIN === "true";

export async function testLoginAction() {
  if (!TEST_LOGIN_ENABLED) {
    throw new Error("Test login is disabled in this environment.");
  }

  const admin = createServiceClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_LOGIN_EMAIL,
  });
  if (error || !data.properties?.hashed_token) {
    throw error ?? new Error("Failed to generate test login link.");
  }

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "email",
  });
  if (verifyError) throw verifyError;

  redirect("/");
}
