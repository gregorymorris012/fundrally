import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Fixed path, no dynamic org-slug segment. Stripe's OAuth redirect_uri
// validation requires an exact string match against what's registered in
// Connect settings — the `*` wildcard the dashboard lets you type into
// `/org/*/stripe/callback` is not honored there ("Invalid redirect URI ...
// exactly matches"), even though it looked like a saved, valid entry.
// The org id (and slug, for the final redirect back) travel through the
// `state` cookie instead — see ../[orgSlug]/stripe/connect/route.ts.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // request.url reports the wrong host under Next.js 16 + Turbopack dev
  // (always "localhost", never the real Host header — verified empirically).
  // Build origin from the header so the final redirect lands back on
  // whatever origin the browser actually used (127.0.0.1 locally); otherwise
  // the Supabase session cookie (also scoped to that origin) won't be sent
  // on the landing page and the user appears signed out. See
  // ../../../org/[orgSlug]/stripe/connect/route.ts for the matching fix on
  // the initiating side.
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  const origin = `${protocol}://${request.headers.get("host")}`;
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("stripe_connect_state")?.value;
  cookieStore.delete("stripe_connect_state");

  const [expectedState, expectedOrgId, expectedOrgSlug] = (stateCookie ?? "").split(":");
  const orgDashboardUrl = expectedOrgSlug
    ? `${origin}/org/${expectedOrgSlug}`
    : origin;

  if (!code || !returnedState || returnedState !== expectedState) {
    return NextResponse.redirect(`${orgDashboardUrl}?stripe_error=state_mismatch`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/auth/sign-in", origin));
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
