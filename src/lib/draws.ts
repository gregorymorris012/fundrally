"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgAdmin } from "@/lib/require-org-admin";

// Build spec rule 1: crypto.randomInt, never Math.random. Standard
// squares-pool mechanic — rows and columns each get the digits 0-9 in
// independent random order (Fisher-Yates), so every row/column
// combination is equally likely and each digit appears exactly once per
// axis, same as a real paper squares board.
function shuffledDigits(): number[] {
  const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits;
}

const UNIQUE_VIOLATION = "23505";

// Build spec rule 2: auditable randomness — every random outcome writes
// an immutable, append-only row (seed, algorithm, inputs, result, actor).
// draws has no client write policy at all (db/migrations/0014), only ever
// inserted here via the service role, and the DB grant for service_role
// on this table is SELECT/INSERT only — no UPDATE, no DELETE, enforced at
// the privilege level too. One draw per module: real squares numbers get
// drawn once, not re-rolled. The pre-check below is just a fast, friendly
// path — the actual guarantee is the unique index on draws.module_id
// (0015_draws_module_unique.sql), since the pre-check alone has a race
// window between two concurrent draws that a check-then-insert can't close.
export async function drawSquaresCore(input: {
  orgId: string;
  moduleId: string;
  actor: string;
}) {
  const admin = createServiceClient();

  const { count: existing } = await admin
    .from("draws")
    .select("id", { count: "exact", head: true })
    .eq("module_id", input.moduleId);
  if (existing && existing > 0) {
    throw new Error("this module has already been drawn");
  }

  const rowDigits = shuffledDigits();
  const colDigits = shuffledDigits();

  const { data, error } = await admin
    .from("draws")
    .insert({
      org_id: input.orgId,
      module_id: input.moduleId,
      algorithm:
        "crypto.randomInt fisher-yates, rows and columns shuffled independently",
      inputs: { rows: 10, cols: 10 },
      result: { rowDigits, colDigits },
      actor: input.actor,
    })
    .select()
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error("this module has already been drawn");
    }
    throw error;
  }
  if (!data) throw new Error("failed to record draw");

  return data as { id: string; result: { rowDigits: number[]; colDigits: number[] } };
}

export async function drawSquares(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));

  const userId = await requireOrgAdmin(orgId);
  await drawSquaresCore({ orgId, moduleId, actor: userId });

  revalidatePath(
    `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`,
  );
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
}
