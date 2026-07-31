import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { addOfflineGiftCore } from "@/lib/payments/offline-gift";
import {
  DEMO_OWNER_EMAIL,
  DEMO_ORG_SLUG,
  DEMO_FUNDRAISER_SLUG,
} from "@/lib/demo-mode";

// Deliberately NOT the DEMO_MODE_ENABLED flag from lib/demo-mode.ts — that
// one is on by default outside production so the dashboard's Stripe
// messaging softens in ordinary local dev. Seeding is more consequential
// (it deletes and recreates a real set of rows), so this has its own,
// stricter gate: no production opt-in at all, matching the spirit of
// TEST_LOGIN_ENABLED but without its NEXT_PUBLIC_* escape hatch.
const SEED_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.ENABLE_DEV_SEED === "true";

// Runs inside Next's own server runtime (a route handler hit via HTTP),
// not a standalone node/tsx script — see CLAUDE.md-adjacent note in
// src/lib/demo-mode.ts's history: a bare `node -e` script that imports
// @supabase/supabase-js directly crashes on Node 18 (no global
// WebSocket, which @supabase/realtime-js's constructor needs), while the
// same client construction inside the bundled Next app does not. Keeping
// this as a route sidesteps that entirely.
export async function POST() {
  if (!SEED_ENABLED) {
    return NextResponse.json(
      { error: "Seeding is disabled in this environment." },
      { status: 403 },
    );
  }

  const admin = createServiceClient();

  // Idempotent: wipe any previous run first. Cascades through
  // memberships/fundraisers/modules/module_availability/transactions/
  // participants (all FK'd to organizations with onDelete cascade), so
  // re-running this always produces a clean, predictable demo state.
  await admin.from("organizations").delete().eq("slug", DEMO_ORG_SLUG);

  // Demo owner account: generateLink creates the user as a side effect
  // when the email doesn't exist yet (same mechanism as testLoginAction
  // in src/lib/auth.ts), so this is safe to call on every run.
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: DEMO_OWNER_EMAIL,
  });
  if (linkError || !linkData.user) {
    return NextResponse.json(
      { error: linkError?.message ?? "failed to create demo owner" },
      { status: 500 },
    );
  }
  const ownerId = linkData.user.id;

  // organizations/memberships have no client-side INSERT policy at all
  // (see db/migrations/0001_rls_policies.sql) — the only path is
  // create_organization(), a SECURITY DEFINER RPC that reads auth.uid()
  // from a live session. There's no live session here (this is a
  // system-level bootstrap, not a real sign-in), so this inserts directly
  // via the service role instead, same class of exception as the rest of
  // this route.
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: "NuPath",
      slug: DEMO_ORG_SLUG,
      state_code: "ME",
      charges_enabled: false,
    })
    .select("id, slug")
    .single();
  if (orgError || !org) {
    return NextResponse.json(
      { error: orgError?.message ?? "failed to create demo org" },
      { status: 500 },
    );
  }

  await admin
    .from("memberships")
    .insert({ org_id: org.id, user_id: ownerId, role: "owner" });

  const { data: fundraiser, error: fundraiserError } = await admin
    .from("fundraisers")
    .insert({
      org_id: org.id,
      title: "NuPath 2026",
      slug: DEMO_FUNDRAISER_SLUG,
      status: "active",
      goal_amount_cents: 1_000_000,
    })
    .select("id, slug")
    .single();
  if (fundraiserError || !fundraiser) {
    return NextResponse.json(
      { error: fundraiserError?.message ?? "failed to create demo fundraiser" },
      { status: 500 },
    );
  }

  // Chance-based types need module_availability.enabled before they're
  // creatable (see createChanceModuleCore in src/lib/modules.ts).
  await admin.from("module_availability").insert([
    { org_id: org.id, module_type: "squares", enabled: true },
    { org_id: org.id, module_type: "fifty_fifty", enabled: true },
  ]);

  const { data: productModule } = await admin
    .from("modules")
    .insert({ org_id: org.id, fundraiser_id: fundraiser.id, type: "product", status: "active" })
    .select("id")
    .single();
  const { data: squaresModule } = await admin
    .from("modules")
    .insert({ org_id: org.id, fundraiser_id: fundraiser.id, type: "squares", status: "active" })
    .select("id")
    .single();
  // Left in 'draft' on purpose — demonstrates the launch button still
  // works in the demo, rather than every module arriving pre-launched.
  await admin
    .from("modules")
    .insert({ org_id: org.id, fundraiser_id: fundraiser.id, type: "fifty_fifty", status: "draft" })
    .select("id")
    .single();

  // Populated via the real offline-gift-entry code path — no throwaway
  // insert logic duplicating what addOfflineGiftCore already does. A
  // spread of donors/amounts/methods across the last two weeks, split
  // across modules and the general (no-module) master campaign, so the
  // dashboard's method breakdown and time series look like real activity
  // rather than a flat line. Deliberately no 'stripe'-method rows here:
  // faking a real Stripe PaymentIntent + webhook round trip just for seed
  // flavor adds real fragility (a live Stripe test-mode call, or a
  // hand-forged webhook event) for a purely cosmetic gain — offline gifts
  // alone already exercise every part of the dashboard this stage cares
  // about. Skip if a genuine Stripe test-mode donation is wanted later.
  const gifts: {
    donorName: string;
    amountCents: number;
    method: "cash" | "check" | "in_kind" | "other";
    moduleId: string | null;
    daysAgo: number;
  }[] = [
    { donorName: "Maria Chen", amountCents: 5000, method: "cash", moduleId: null, daysAgo: 13 },
    { donorName: "Riverside Hardware", amountCents: 25000, method: "check", moduleId: null, daysAgo: 13 },
    { donorName: "Tom Alvarez", amountCents: 2000, method: "cash", moduleId: productModule?.id ?? null, daysAgo: 12 },
    { donorName: "Priya Nair", amountCents: 4500, method: "other", moduleId: squaresModule?.id ?? null, daysAgo: 11 },
    { donorName: "Jonas Becker", amountCents: 10000, method: "check", moduleId: null, daysAgo: 10 },
    { donorName: "Sunset Diner", amountCents: 15000, method: "in_kind", moduleId: null, daysAgo: 9 },
    { donorName: "Grace Kim", amountCents: 3000, method: "cash", moduleId: productModule?.id ?? null, daysAgo: 9 },
    { donorName: "Wesley Group", amountCents: 20000, method: "check", moduleId: null, daysAgo: 8 },
    { donorName: "Ana Torres", amountCents: 5000, method: "cash", moduleId: squaresModule?.id ?? null, daysAgo: 7 },
    { donorName: "Devon Price", amountCents: 7500, method: "other", moduleId: productModule?.id ?? null, daysAgo: 6 },
    { donorName: "Helen Brooks", amountCents: 25000, method: "check", moduleId: null, daysAgo: 5 },
    { donorName: "Marcus Lee", amountCents: 2500, method: "cash", moduleId: squaresModule?.id ?? null, daysAgo: 4 },
    { donorName: "Yuki Tanaka", amountCents: 6000, method: "cash", moduleId: null, daysAgo: 3 },
    { donorName: "Old Town Bakery", amountCents: 10000, method: "in_kind", moduleId: productModule?.id ?? null, daysAgo: 2 },
    { donorName: "Sarah Whitfield", amountCents: 15000, method: "check", moduleId: null, daysAgo: 1 },
    { donorName: "Community Fund", amountCents: 30000, method: "check", moduleId: null, daysAgo: 0 },
  ];

  for (const gift of gifts) {
    const receivedAt = new Date();
    receivedAt.setDate(receivedAt.getDate() - gift.daysAgo);
    await addOfflineGiftCore({
      orgId: org.id,
      fundraiserId: fundraiser.id,
      moduleId: gift.moduleId,
      donorName: gift.donorName,
      amountCents: gift.amountCents,
      method: gift.method,
      receivedAt: receivedAt.toISOString().slice(0, 10),
      enteredBy: ownerId,
    });
  }

  return NextResponse.json({
    ok: true,
    orgSlug: org.slug,
    fundraiserSlug: fundraiser.slug,
    giftsCreated: gifts.length,
    totalGoalCents: 1_000_000,
  });
}
