"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgAdmin } from "@/lib/require-org-admin";
import { addOfflineGiftCore, voidOfflineGiftCore } from "@/lib/payments/offline-gift";
import type { SquaresConfig } from "@/lib/squares-config";

const MAX_NAME_LENGTH = 100;
const UNIQUE_VIOLATION = "23505";

// Free, no-money participation record — see db/schema/module-entries.ts.
// Service role because module_entries has no client-side INSERT policy at
// all (same shape as guest checkout's participant creation): a public
// visitor has no session to scope an RLS policy to. `position` (0-99) is
// squares-only — the partial unique index in
// 0014_draws_and_squares_positions.sql is what actually stops two guests
// claiming the same square; the 23505 catch here just turns that into a
// readable error instead of a raw constraint-violation message.
//
// Squares claims additionally check the module's config (locked/password)
// and snapshot its configured price into price_cents — see
// db/schema/module-entries.ts for why that's a snapshot, not a live
// read. Still service-role, same reasoning — a guest has no session, and
// the config read has to happen server-side anyway since it's what a
// guest could otherwise bypass by not sending a position.
export async function joinModuleCore(input: {
  orgId: string;
  moduleId: string;
  displayName: string;
  note?: string | null;
  position?: number | null;
  password?: string | null;
}) {
  const displayName = input.displayName.trim().slice(0, MAX_NAME_LENGTH);
  if (!displayName) {
    throw new Error("name is required");
  }
  if (
    input.position != null &&
    (!Number.isInteger(input.position) || input.position < 0 || input.position > 99)
  ) {
    throw new Error("position must be between 0 and 99");
  }

  const admin = createServiceClient();

  let priceCents: number | null = null;
  if (input.position != null) {
    const { data: module_, error: moduleError } = await admin
      .from("modules")
      .select("config")
      .eq("id", input.moduleId)
      .maybeSingle();
    if (moduleError || !module_) throw new Error("module not found");
    const config = (module_.config as SquaresConfig) ?? {};

    if (config.locked) {
      throw new Error("this board is locked — no new claims right now");
    }
    if (config.joinPasswordHash) {
      const suppliedHash = createHash("sha256")
        .update(input.password ?? "")
        .digest("hex");
      if (suppliedHash !== config.joinPasswordHash) {
        throw new Error("incorrect password");
      }
    }
    priceCents = config.pricePerSquareCents ?? null;
  }

  const { error } = await admin.from("module_entries").insert({
    org_id: input.orgId,
    module_id: input.moduleId,
    display_name: displayName,
    note: input.note?.trim() || null,
    position: input.position ?? null,
    price_cents: priceCents,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error("that square is already taken — pick another");
    }
    throw error;
  }
}

export async function joinModule(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const displayName = String(formData.get("displayName"));
  const note = String(formData.get("note") ?? "");
  const positionRaw = formData.get("position");
  const position = positionRaw != null && positionRaw !== "" ? Number(positionRaw) : null;
  const password = String(formData.get("password") ?? "");

  await joinModuleCore({ orgId, moduleId, displayName, note, position, password });

  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
}

async function fetchEntry(orgId: string, moduleId: string, entryId: string) {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("module_entries")
    .select("id, display_name, position, price_cents, transaction_id")
    .eq("id", entryId)
    .eq("module_id", moduleId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error || !data) throw new Error("square not found");
  return data;
}

// Reuses addOfflineGiftCore (src/lib/payments/offline-gift.ts) rather than
// writing a second payment path — this is the required reuse point per
// CLAUDE.md's ledger rules: real dollars a squares admin collects in
// person become a real transactions row through the exact same function
// offline-gift entry already uses, not a new one. module_entries stays
// the free/no-money record; this just links it to the real ledger row.
export async function markSquarePaidCore(input: {
  orgId: string;
  fundraiserId: string;
  moduleId: string;
  entryId: string;
  method: "cash" | "check" | "in_kind" | "other";
  enteredBy: string;
  reference?: string | null;
}) {
  const entry = await fetchEntry(input.orgId, input.moduleId, input.entryId);
  if (entry.transaction_id) {
    throw new Error("already marked paid — void it first to correct");
  }
  if (!entry.price_cents) {
    throw new Error("this square has no price configured, nothing to collect");
  }

  const transaction = await addOfflineGiftCore({
    orgId: input.orgId,
    fundraiserId: input.fundraiserId,
    moduleId: input.moduleId,
    donorName: entry.display_name,
    amountCents: entry.price_cents,
    method: input.method,
    receivedAt: new Date().toISOString(),
    reference: input.reference || `Square #${entry.position}`,
    enteredBy: input.enteredBy,
  });

  const admin = createServiceClient();
  const { error } = await admin
    .from("module_entries")
    .update({ transaction_id: transaction.id })
    .eq("id", input.entryId);
  if (error) throw error;

  await admin.from("audit_log").insert({
    org_id: input.orgId,
    actor: input.enteredBy,
    action: "square.paid",
    after: {
      module_id: input.moduleId,
      entry_id: input.entryId,
      position: entry.position,
      transaction_id: transaction.id,
      amount_cents: entry.price_cents,
    },
  });

  return { transactionId: transaction.id as string };
}

export async function markSquarePaid(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const fundraiserId = String(formData.get("fundraiserId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const entryId = String(formData.get("entryId"));
  const method = String(formData.get("method")) as "cash" | "check" | "in_kind" | "other";

  const userId = await requireOrgAdmin(orgId);

  await markSquarePaidCore({
    orgId,
    fundraiserId,
    moduleId,
    entryId,
    method,
    enteredBy: userId,
  });

  revalidatePath(
    `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`,
  );
}

// Reuses voidOfflineGiftCore — creates the kind='adjustment' correction
// row per the ledger's never-edit-in-place rule (same as any other
// offline-gift void), then reverts this square back to unpaid (still
// claimed — void does not release it).
export async function voidSquarePaymentCore(input: {
  orgId: string;
  moduleId: string;
  entryId: string;
  enteredBy: string;
}) {
  const entry = await fetchEntry(input.orgId, input.moduleId, input.entryId);
  if (!entry.transaction_id) {
    throw new Error("this square isn't marked paid");
  }

  await voidOfflineGiftCore({
    orgId: input.orgId,
    transactionId: entry.transaction_id,
    enteredBy: input.enteredBy,
  });

  const admin = createServiceClient();
  const { error } = await admin
    .from("module_entries")
    .update({ transaction_id: null })
    .eq("id", input.entryId);
  if (error) throw error;

  await admin.from("audit_log").insert({
    org_id: input.orgId,
    actor: input.enteredBy,
    action: "square.payment_voided",
    after: {
      module_id: input.moduleId,
      entry_id: input.entryId,
      position: entry.position,
      voided_transaction_id: entry.transaction_id,
    },
  });
}

export async function voidSquarePayment(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const entryId = String(formData.get("entryId"));

  const userId = await requireOrgAdmin(orgId);

  await voidSquarePaymentCore({ orgId, moduleId, entryId, enteredBy: userId });

  revalidatePath(
    `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`,
  );
}

// Nulls `position` rather than deleting the row, so the claim's history
// (display_name, when it happened) survives for the activity log while
// immediately freeing that position for a new claim via the existing
// partial unique index (module_entries_module_position_unique).
export async function releaseSquareCore(input: {
  orgId: string;
  moduleId: string;
  entryId: string;
  actor: string;
}) {
  const entry = await fetchEntry(input.orgId, input.moduleId, input.entryId);
  if (entry.transaction_id) {
    throw new Error("paid squares can't be released — void the payment first");
  }
  if (entry.position == null) {
    throw new Error("this square has already been released");
  }

  const admin = createServiceClient();
  const { error } = await admin
    .from("module_entries")
    .update({ position: null })
    .eq("id", input.entryId);
  if (error) throw error;

  await admin.from("audit_log").insert({
    org_id: input.orgId,
    actor: input.actor,
    action: "square.released",
    after: {
      module_id: input.moduleId,
      entry_id: input.entryId,
      position: entry.position,
      display_name: entry.display_name,
    },
  });
}

export async function releaseSquare(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const entryId = String(formData.get("entryId"));

  const userId = await requireOrgAdmin(orgId);

  await releaseSquareCore({ orgId, moduleId, entryId, actor: userId });

  revalidatePath(
    `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`,
  );
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
}

// Bulk sweep, admin-triggered only — no cron infra exists in this repo.
// One batched audit_log row rather than one per square, since this is
// conceptually a single organizer action ("clean up stale reservations"),
// not N separate events.
export async function releaseStaleSquaresCore(input: {
  orgId: string;
  moduleId: string;
  olderThanHours: number;
  actor: string;
}) {
  const admin = createServiceClient();
  const cutoff = new Date(Date.now() - input.olderThanHours * 60 * 60 * 1000).toISOString();

  const { data: stale, error: selectError } = await admin
    .from("module_entries")
    .select("id, position")
    .eq("org_id", input.orgId)
    .eq("module_id", input.moduleId)
    .is("transaction_id", null)
    .not("position", "is", null)
    .lt("created_at", cutoff);
  if (selectError) throw selectError;
  if (!stale?.length) return { releasedCount: 0 };

  const ids = stale.map((e) => e.id);
  const { error: updateError } = await admin
    .from("module_entries")
    .update({ position: null })
    .in("id", ids);
  if (updateError) throw updateError;

  await admin.from("audit_log").insert({
    org_id: input.orgId,
    actor: input.actor,
    action: "squares.stale_swept",
    after: {
      module_id: input.moduleId,
      released_entry_ids: ids,
      released_positions: stale.map((e) => e.position),
      older_than_hours: input.olderThanHours,
    },
  });

  return { releasedCount: ids.length };
}

export async function releaseStaleSquares(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const olderThanHoursRaw = String(formData.get("olderThanHours") ?? "24");
  const olderThanHours = Number(olderThanHoursRaw) || 24;

  const userId = await requireOrgAdmin(orgId);

  await releaseStaleSquaresCore({ orgId, moduleId, olderThanHours, actor: userId });

  revalidatePath(
    `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`,
  );
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
}
