"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/client";
import { computeFeeCents } from "@/lib/stripe/fees";

export async function createOrderIntent(input: {
  orgSlug: string;
  fundraiserSlug: string;
  items: { productId: string; quantity: number }[];
  guestName: string;
  guestEmail: string;
}) {
  if (input.items.length === 0) throw new Error("cart is empty");
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("invalid quantity");
    }
  }

  // Same "never trust the client for money" shape as createDonationIntent:
  // re-derive org/fundraiser/module/products server-side, and compute the
  // total from the DB's current prices, not anything the client sent.
  const supabase = await createClient();
  const { data: fundraiser, error: fundraiserError } = await supabase
    .from("fundraisers")
    .select("id, status, org_id, organizations!inner(id, slug, stripe_account_id, charges_enabled)")
    .eq("slug", input.fundraiserSlug)
    .eq("organizations.slug", input.orgSlug)
    .maybeSingle();
  if (fundraiserError || !fundraiser || fundraiser.status !== "active") {
    throw new Error("fundraiser not found or not active");
  }

  const org = Array.isArray(fundraiser.organizations)
    ? fundraiser.organizations[0]
    : fundraiser.organizations;
  if (!org || !org.stripe_account_id || !org.charges_enabled) {
    throw new Error("organization is not able to accept payments yet");
  }

  const { data: shopModule, error: moduleError } = await supabase
    .from("modules")
    .select("id")
    .eq("fundraiser_id", fundraiser.id)
    .eq("type", "product")
    .eq("status", "active")
    .maybeSingle();
  if (moduleError || !shopModule) throw new Error("shop not available");

  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, price_cents")
    .eq("module_id", shopModule.id)
    .eq("status", "active")
    .in("id", productIds);
  if (productsError || !products || products.length !== productIds.length) {
    throw new Error("one or more items are no longer available");
  }
  const productById = new Map(products.map((p) => [p.id, p]));

  let grossCents = 0;
  for (const item of input.items) {
    grossCents += productById.get(item.productId)!.price_cents * item.quantity;
  }

  // service role: guest checkout has no session (see createDonationIntent
  // for the same reasoning), and orders/order_items have no client INSERT
  // policy at all — only server code writes them.
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

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      org_id: org.id,
      fundraiser_id: fundraiser.id,
      module_id: shopModule.id,
      participant_id: participant.id,
      status: "pending",
    })
    .select("id")
    .single();
  if (orderError || !order) throw new Error("failed to create order");

  const { error: orderItemsError } = await admin.from("order_items").insert(
    input.items.map((item) => ({
      order_id: order.id,
      product_id: item.productId,
      quantity: item.quantity,
      unit_price_cents: productById.get(item.productId)!.price_cents,
    })),
  );
  if (orderItemsError) throw new Error("failed to create order items");

  const feeCents = computeFeeCents(grossCents);

  const paymentIntent = await getStripe().paymentIntents.create(
    {
      amount: grossCents,
      currency: "usd",
      application_fee_amount: feeCents,
      automatic_payment_methods: { enabled: true },
      metadata: {
        org_id: org.id,
        fundraiser_id: fundraiser.id,
        participant_id: participant.id,
        module_id: shopModule.id,
        order_id: order.id,
        kind: "purchase",
      },
    },
    {
      stripeAccount: org.stripe_account_id,
      idempotencyKey: randomUUID(),
    },
  );

  return { clientSecret: paymentIntent.client_secret };
}
