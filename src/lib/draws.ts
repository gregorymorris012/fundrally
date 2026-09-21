"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
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
// the privilege level too.
//
// One draw per pool. The row/column digits are drawn once and stay the same
// for the whole game — periods (quarters, halftime, final) each pay the
// square those fixed numbers point to at that score; they do not redraw.
// (An earlier version redrew per period, which isn't how squares works.)
// The `segment` column predates this and is now vestigial: every draw is
// written as 'final', which the unique index on (module_id, segment)
// (0020_squares_segments_and_grants.sql) turns into a DB-level "exactly one
// draw per module" guarantee. The pre-check below is just the friendly
// path — the index is what closes the race between two concurrent clicks.
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
    throw new Error("the numbers have already been drawn");
  }

  const rowDigits = shuffledDigits();
  const colDigits = shuffledDigits();

  const { data, error } = await admin
    .from("draws")
    .insert({
      org_id: input.orgId,
      module_id: input.moduleId,
      segment: "final",
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
      throw new Error("the numbers have already been drawn");
    }
    throw error;
  }
  if (!data) throw new Error("failed to record draw");

  return data as {
    id: string;
    result: { rowDigits: number[]; colDigits: number[] };
  };
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
