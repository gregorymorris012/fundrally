"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/client";

// Server-initiated only (build spec section 5) — there is no client path
// that touches Stripe refunds directly. This only *starts* the refund;
// the actual negative ledger row is written by the charge.refunded
// webhook (rule 3), not here. What this function writes to audit_log is
// the distinct fact that a human initiated it.
export async function refundTransaction(transactionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("must be authenticated");

  // RLS (org members can read) confirms the caller can even see this
  // transaction; the explicit role check below is what actually gates
  // who may refund (any member can read, only owner/admin can act).
  const { data: transaction, error: transactionError } = await supabase
    .from("transactions")
    .select("id, org_id, stripe_payment_intent_id, gross_cents")
    .eq("id", transactionId)
    .eq("kind", "donation")
    .maybeSingle();
  if (transactionError || !transaction) throw new Error("transaction not found");

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", transaction.org_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    throw new Error("forbidden");
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("slug, stripe_account_id")
    .eq("id", transaction.org_id)
    .single();
  if (!org?.stripe_account_id || !transaction.stripe_payment_intent_id) {
    throw new Error("organization is not connected to Stripe");
  }

  const refund = await getStripe().refunds.create(
    { payment_intent: transaction.stripe_payment_intent_id },
    { stripeAccount: org.stripe_account_id, idempotencyKey: randomUUID() },
  );

  // audit_log has no client INSERT policy (service-role only), same as
  // transactions — authorization already happened above via the
  // RLS-scoped reads.
  const admin = createServiceClient();
  await admin.from("audit_log").insert({
    org_id: transaction.org_id,
    actor: user.id,
    action: "refund.initiated",
    before: { transaction_id: transaction.id, gross_cents: transaction.gross_cents },
    after: { stripe_refund_id: refund.id, status: refund.status },
  });

  revalidatePath(`/org/${org.slug}`);
}
