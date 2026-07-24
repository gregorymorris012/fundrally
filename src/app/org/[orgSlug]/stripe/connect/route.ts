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
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/auth/sign-in", request.url));
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
  cookieStore.set("stripe_connect_state", `${state}:${org.id}`, {
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
    new URL(`/org/${orgSlug}/stripe/callback`, request.url).toString(),
  );

  return NextResponse.redirect(authorizeUrl);
}
