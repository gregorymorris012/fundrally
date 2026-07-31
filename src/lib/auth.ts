"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { DEMO_MODE_ENABLED, DEMO_OWNER_EMAIL } from "@/lib/demo-mode";

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
//
// Each click creates a brand-new account (random suffix) rather than
// reusing one fixed email: a shared Preview link means multiple people
// testing at once, and a fixed account meant only the first person ever
// saw the zero-orgs onboarding flow — everyone after them inherited
// whatever org that first person created. Random-per-click means every
// tester independently gets the real first-run experience.
const TEST_LOGIN_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_TEST_LOGIN === "true";

export async function testLoginAction() {
  if (!TEST_LOGIN_ENABLED) {
    throw new Error("Test login is disabled in this environment.");
  }

  const email = `test-${Math.random().toString(36).slice(2, 10)}@fundrally.test`;
  const admin = createServiceClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
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

// Same Admin-API generateLink+verifyOtp mechanism as testLoginAction, same
// gate, but a FIXED email rather than a random one per click — see
// DEMO_OWNER_EMAIL in src/lib/demo-mode.ts for why: this is the
// stakeholder-walkthrough entry point, which needs to land on the same
// pre-seeded fundraiser every time, not a fresh blank org. Requires the
// seed route (src/app/api/dev/seed/route.ts) to have already run at least
// once so this email actually owns the demo org.
export async function demoLoginAction() {
  if (!DEMO_MODE_ENABLED) {
    throw new Error("Demo mode is disabled in this environment.");
  }

  const admin = createServiceClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: DEMO_OWNER_EMAIL,
  });
  if (error || !data.properties?.hashed_token) {
    throw error ?? new Error("Failed to generate demo login link.");
  }

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "email",
  });
  if (verifyError) throw verifyError;

  redirect("/");
}
