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
const TEST_PHONES = ["+15005550001", "+15005550002"] as const;
const TEST_OTP = "123456";

export async function signInTestUser(index: 0 | 1) {
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
