"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/client";
import { computeFeeCents } from "@/lib/stripe/fees";

const MIN_DONATION_CENTS = 100;

export async function createDonationIntent(input: {
  orgSlug: string;
  fundraiserSlug: string;
  amountCents: number;
  guestName: string;
  guestEmail: string;
}) {
  if (!Number.isInteger(input.amountCents) || input.amountCents < MIN_DONATION_CENTS) {
    throw new Error(`amount must be an integer >= ${MIN_DONATION_CENTS} cents`);
  }

  // Re-derive everything money-relevant server-side from the slugs — never
  // trust org/fundraiser ids or Stripe account ids if a client ever sends
  // them. Uses the anon-capable client: db/migrations/0005_public_donate_policies.sql
  // makes exactly the fields a public donate page needs readable.
  const supabase = await createClient();
  const { data: fundraiser, error: fundraiserError } = await supabase
    .from("fundraisers")
    .select("id, status, org_id, organizations(id, stripe_account_id, charges_enabled)")
    .eq("slug", input.fundraiserSlug)
    .maybeSingle();

  if (fundraiserError || !fundraiser || fundraiser.status !== "active") {
    throw new Error("fundraiser not found or not active");
  }

  const org = Array.isArray(fundraiser.organizations)
    ? fundraiser.organizations[0]
    : fundraiser.organizations;
  if (!org || org.id !== fundraiser.org_id) {
    throw new Error("fundraiser not found or not active");
  }
  if (!org.stripe_account_id || !org.charges_enabled) {
    throw new Error("organization is not able to accept payments yet");
  }

  // service role: participants has no client-side INSERT policy (guest
  // checkout must work without an account, so there's no authenticated
  // user to scope an RLS policy to — see db/schema/participants.ts).
  const admin = createServiceClient();
  const { data: participant, error: participantError } = await admin
    .from("participants")
    .insert({
      org_id: org.id,
      display_name: input.guestName,
      email: input.guestEmail,
    })
    .select("id")
    .single();
  if (participantError || !participant) {
    throw new Error("failed to record participant");
  }

  const feeCents = computeFeeCents(input.amountCents);

  // idempotencyKey here is freshly generated per attempt, which satisfies
  // rule 6 (every Stripe call has one) but does not by itself dedupe a
  // browser-level retry of the same submission — that would need a
  // client-generated, stably-reused key. Fine for Phase 1's job (prove the
  // pipe works); revisit before this is exposed to real donors at volume.
  const paymentIntent = await getStripe().paymentIntents.create(
    {
      amount: input.amountCents,
      currency: "usd",
      application_fee_amount: feeCents,
      automatic_payment_methods: { enabled: true },
      metadata: {
        org_id: org.id,
        fundraiser_id: fundraiser.id,
        participant_id: participant.id,
        kind: "donation",
      },
    },
    {
      stripeAccount: org.stripe_account_id,
      idempotencyKey: randomUUID(),
    },
  );

  return { clientSecret: paymentIntent.client_secret };
}
