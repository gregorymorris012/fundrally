import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const orgDashboardUrl = `${origin}/org/${orgSlug}`;

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("stripe_connect_state")?.value;
  cookieStore.delete("stripe_connect_state");

  const [expectedState, expectedOrgId] = (stateCookie ?? "").split(":");
  if (!code || !returnedState || returnedState !== expectedState) {
    return NextResponse.redirect(`${orgDashboardUrl}?stripe_error=state_mismatch`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/auth/sign-in", request.url));
  }

  const tokenResponse = await fetch("https://connect.stripe.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_secret: process.env.STRIPE_SECRET_KEY!,
      grant_type: "authorization_code",
      code,
    }),
  });
  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok || !tokenData.stripe_user_id) {
    return NextResponse.redirect(`${orgDashboardUrl}?stripe_error=token_exchange_failed`);
  }

  // service role: organizations has no client UPDATE policy (see
  // db/migrations/0001_rls_policies.sql) — writes to it are server-only by
  // design, same shape as create_organization().
  const admin = createServiceClient();
  const { error: updateError } = await admin
    .from("organizations")
    .update({ stripe_account_id: tokenData.stripe_user_id })
    .eq("id", expectedOrgId);

  if (updateError) {
    return NextResponse.redirect(`${orgDashboardUrl}?stripe_error=save_failed`);
  }

  await admin.from("audit_log").insert({
    org_id: expectedOrgId,
    actor: user.id,
    action: "stripe.connect.completed",
    after: { stripe_account_id: tokenData.stripe_user_id },
  });

  return NextResponse.redirect(`${orgDashboardUrl}?stripe_connected=1`);
}
