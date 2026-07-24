import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run \`supabase start\` and copy its output into .env.local (see .env.example).`,
    );
  }
  return value;
}

export function anonClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}

export function serviceClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );
}

// Fixed phone -> OTP pairs registered in supabase/config.toml
// ([auth.sms.test_otp]), local dev only. Lets these tests exercise the real
// phone-OTP sign-in path without a live Twilio account.
//
// There are 10 numbers, not 3, because gotrue rate-limits OTP requests per
// phone number (max_frequency, 5s) regardless of which process or test
// file makes the request. Every test file MUST use a disjoint slice of
// these indices — never reuse an index another file also uses — or
// suites become flaky/fail outright when run together (the whole point of
// having this many). Current allocation:
//   0-1: tests/rls/cross-tenant.test.ts
//   2-4: tests/rls/phase1-cross-tenant.test.ts
//   5-7: tests/rls/phase2-cross-tenant.test.ts
//   8:   tests/money/webhook-handlers.test.ts
//   9:   tests/money/purchase-flow.test.ts
const TEST_PHONES = [
  "+15005550001",
  "+15005550002",
  "+15005550003",
  "+15005550004",
  "+15005550005",
  "+15005550006",
  "+15005550007",
  "+15005550008",
  "+15005550009",
  "+15005550010",
] as const;
const TEST_OTP = "123456";

export async function signInTestUser(index: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9) {
  const client = anonClient();
  const phone = TEST_PHONES[index];

  const { error: otpError } = await client.auth.signInWithOtp({ phone });
  if (otpError) throw otpError;

  const { data, error } = await client.auth.verifyOtp({
    phone,
    token: TEST_OTP,
    type: "sms",
  });
  if (error) throw error;
  if (!data.user) throw new Error("verifyOtp did not return a user");

  return { client, userId: data.user.id };
}

export async function createTestOrgWithFundraiser(
  owner: Awaited<ReturnType<typeof signInTestUser>>,
  suffix: string,
) {
  const { data: orgId, error: orgError } = await owner.client.rpc(
    "create_organization",
    { p_name: `Test Org ${suffix}`, p_slug: `test-org-${suffix}`, p_state_code: "CA" },
  );
  if (orgError) throw orgError;

  const { data: fundraiser, error: fundraiserError } = await owner.client
    .from("fundraisers")
    .insert({
      org_id: orgId,
      title: `Test Fundraiser ${suffix}`,
      slug: `test-fundraiser-${suffix}`,
      status: "active",
    })
    .select("id")
    .single();
  if (fundraiserError) throw fundraiserError;

  return { orgId: orgId as string, fundraiserId: fundraiser.id as string };
}
