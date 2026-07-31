"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const MIN_GIFT_CENTS = 1;

// CLAUDE.md ledger invariants: Stripe is one writer to `transactions`, not
// the ledger itself — this is the second. Same rule-3 shape as the webhook
// handler (service role, never a client-side write), but the actor here is
// a real authenticated org admin recording a real-world gift, not a
// webhook. Uses the service-role client because `transactions` and
// `participants` have no client-side INSERT policy at all (by design —
// see db/schema/participants.ts and db/migrations/0001_rls_policies.sql),
// so the admin-role check below is what actually gates this, the same way
// refundTransaction() in refund.ts gates a service-role-adjacent write.
export async function addOfflineGiftCore(input: {
  orgId: string;
  fundraiserId: string;
  moduleId?: string | null;
  donorName: string;
  amountCents: number;
  method: "cash" | "check" | "in_kind" | "other";
  receivedAt: string;
  reference?: string | null;
  enteredBy: string;
}) {
  if (!Number.isInteger(input.amountCents) || input.amountCents < MIN_GIFT_CENTS) {
    throw new Error(`amount must be an integer >= ${MIN_GIFT_CENTS} cents`);
  }

  const admin = createServiceClient();

  const { data: participant, error: participantError } = await admin
    .from("participants")
    .insert({ org_id: input.orgId, display_name: input.donorName })
    .select("id")
    .single();
  if (participantError || !participant) {
    throw new Error("failed to record donor");
  }

  const { data: transaction, error: transactionError } = await admin
    .from("transactions")
    .insert({
      org_id: input.orgId,
      fundraiser_id: input.fundraiserId,
      module_id: input.moduleId ?? null,
      participant_id: participant.id,
      kind: "donation",
      method: input.method,
      gross_cents: input.amountCents,
      fee_cents: 0,
      net_cents: input.amountCents,
      currency: "usd",
      status: "succeeded",
      entered_by: input.enteredBy,
      entered_at: input.receivedAt,
      reference: input.reference || null,
    })
    .select()
    .single();
  if (transactionError || !transaction) {
    throw new Error("failed to record gift");
  }

  await admin.from("audit_log").insert({
    org_id: input.orgId,
    actor: input.enteredBy,
    action: "offline_gift.created",
    after: {
      transaction_id: transaction.id,
      gross_cents: input.amountCents,
      method: input.method,
    },
  });

  return transaction as { id: string };
}

// CLAUDE.md ledger invariants: a posted transaction is never edited in
// place. Correcting a bad manual entry means a new kind='adjustment' row
// referencing the original via adjusts_transaction_id — same shape as a
// Stripe kind='refund' row referencing its charge — never an UPDATE of the
// original row's amount/status.
export async function voidOfflineGiftCore(input: {
  orgId: string;
  transactionId: string;
  enteredBy: string;
  reference?: string | null;
}) {
  const admin = createServiceClient();

  const { data: original, error: originalError } = await admin
    .from("transactions")
    .select("id, org_id, fundraiser_id, module_id, participant_id, gross_cents, method, kind")
    .eq("id", input.transactionId)
    .eq("org_id", input.orgId)
    .maybeSingle();
  if (originalError || !original) throw new Error("transaction not found");
  if (original.method === "stripe") {
    throw new Error("stripe transactions are voided via refund, not this path");
  }
  if (original.kind === "adjustment") {
    throw new Error("cannot void an adjustment row itself");
  }

  const { data: adjustment, error: adjustmentError } = await admin
    .from("transactions")
    .insert({
      org_id: original.org_id,
      fundraiser_id: original.fundraiser_id,
      module_id: original.module_id,
      participant_id: original.participant_id,
      kind: "adjustment",
      method: original.method,
      gross_cents: -original.gross_cents,
      fee_cents: 0,
      net_cents: -original.gross_cents,
      currency: "usd",
      status: "succeeded",
      entered_by: input.enteredBy,
      entered_at: new Date().toISOString(),
      reference: input.reference || `Void of ${original.id}`,
      adjusts_transaction_id: original.id,
    })
    .select()
    .single();
  if (adjustmentError || !adjustment) {
    throw new Error("failed to record void");
  }

  await admin.from("audit_log").insert({
    org_id: original.org_id,
    actor: input.enteredBy,
    action: "offline_gift.voided",
    before: { transaction_id: original.id, gross_cents: original.gross_cents },
    after: { transaction_id: adjustment.id },
  });

  return adjustment as { id: string };
}

async function requireOrgAdmin(orgId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("must be authenticated");

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    throw new Error("forbidden");
  }

  return user.id;
}

export async function addOfflineGift(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const fundraiserId = String(formData.get("fundraiserId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const moduleId = String(formData.get("moduleId") ?? "");
  const donorName = String(formData.get("donorName"));
  const amountCents = Math.round(Number(formData.get("amount")) * 100);
  const method = String(formData.get("method")) as "cash" | "check" | "in_kind" | "other";
  const receivedAt = String(formData.get("receivedAt"));
  const reference = String(formData.get("reference") ?? "");

  const userId = await requireOrgAdmin(orgId);

  await addOfflineGiftCore({
    orgId,
    fundraiserId,
    moduleId: moduleId || null,
    donorName,
    amountCents,
    method,
    receivedAt,
    reference,
    enteredBy: userId,
  });

  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}`);
}

export async function voidOfflineGift(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const transactionId = String(formData.get("transactionId"));

  const userId = await requireOrgAdmin(orgId);

  await voidOfflineGiftCore({ orgId, transactionId, enteredBy: userId });

  revalidatePath(`/org/${orgSlug}/fundraisers/${fundraiserSlug}`);
}
