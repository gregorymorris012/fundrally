import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Kicks off Stripe Connect Standard OAuth (build spec section 5:
// "Organizer onboarding -> Stripe Connect OAuth, Standard account"). The
// callback (../callback/route.ts) exchanges the returned code for a
// stripe_user_id and stores it on organizations.stripe_account_id.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;
  // request.url reports the wrong host here (always "localhost", never the
  // real Host header) under Next.js 16 + Turbopack dev — verified
  // empirically, not a doc'd limitation. Build the origin from the header
  // directly so this matches whatever origin the browser actually used
  // (127.0.0.1 locally, per the allowedDevOrigins note in next.config.ts) —
  // otherwise the redirect_uri sent to Stripe lands on a different origin
  // than the one holding the stripe_connect_state cookie, and the callback
  // fails with state_mismatch.
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  const origin = `${protocol}://${request.headers.get("host")}`;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/auth/sign-in", origin));
  }

  // RLS (org members can read) + explicit role check — only owners/admins
  // may initiate Connect onboarding for their org.
  const { data: org, error } = await supabase
    .from("organizations")
    .select("id, slug")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (error || !org) {
    return NextResponse.json({ error: "organization not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const state = randomUUID();
  const cookieStore = await cookies();
  cookieStore.set("stripe_connect_state", `${state}:${org.id}:${orgSlug}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const authorizeUrl = new URL("https://connect.stripe.com/oauth/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", process.env.STRIPE_CONNECT_CLIENT_ID!);
  authorizeUrl.searchParams.set("scope", "read_write");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set(
    "redirect_uri",
    // Fixed path, no dynamic segment — see connect-callback/route.ts for why.
    new URL("/api/stripe/connect-callback", origin).toString(),
  );

  return NextResponse.redirect(authorizeUrl);
}
