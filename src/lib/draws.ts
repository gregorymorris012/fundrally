"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/require-org-admin";
import {
  SEGMENTS_BY_STRUCTURE,
  type SquaresConfig,
  type DrawSegment,
} from "@/lib/squares-config";

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
// One draw per (module, segment) — a module configured for
// payoutStructure: "quarters" gets up to 4 independent draws (q1, q2, q3,
// final), each its own independent shuffle, not one draw reused across
// segments. The pre-check below is just a fast, friendly path — the real
// guarantee is the unique index on (module_id, segment)
// (0020_squares_segments_and_grants.sql, superseding the old
// module-id-only uniqueness), since the pre-check alone has a race window
// between two concurrent draws of the same segment that a check-then-
// insert can't close.
export async function drawSquaresCore(input: {
  orgId: string;
  moduleId: string;
  segment: DrawSegment;
  actor: string;
}) {
  const admin = createServiceClient();

  const { count: existing } = await admin
    .from("draws")
    .select("id", { count: "exact", head: true })
    .eq("module_id", input.moduleId)
    .eq("segment", input.segment);
  if (existing && existing > 0) {
    throw new Error("this segment has already been drawn");
  }

  const rowDigits = shuffledDigits();
  const colDigits = shuffledDigits();

  const { data, error } = await admin
    .from("draws")
    .insert({
      org_id: input.orgId,
      module_id: input.moduleId,
      segment: input.segment,
      algorithm:
        "crypto.randomInt fisher-yates, rows and columns shuffled independently",
      inputs: { rows: 10, cols: 10, segment: input.segment },
      result: { rowDigits, colDigits },
      actor: input.actor,
    })
    .select()
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error("this segment has already been drawn");
    }
    throw error;
  }
  if (!data) throw new Error("failed to record draw");

  return data as {
    id: string;
    segment: DrawSegment;
    result: { rowDigits: number[]; colDigits: number[] };
  };
}

export async function drawSquares(formData: FormData) {
  const orgId = String(formData.get("orgId"));
  const moduleId = String(formData.get("moduleId"));
  const orgSlug = String(formData.get("orgSlug"));
  const fundraiserSlug = String(formData.get("fundraiserSlug"));
  const segment = String(formData.get("segment") ?? "final") as DrawSegment;

  const userId = await requireOrgAdmin(orgId);

  // Confirm this segment is actually one this module is configured for —
  // reject e.g. a "q1" draw on a final_only module — rather than trusting
  // whatever segment the submitted form carried. Plain RLS read (org
  // admins can already read their own org's modules) — no service role
  // needed for this validation lookup.
  const supabase = await createClient();
  const { data: module_, error: moduleError } = await supabase
    .from("modules")
    .select("config")
    .eq("id", moduleId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (moduleError || !module_) throw new Error("module not found");
  const config = (module_.config as SquaresConfig) ?? {};
  const allowedSegments = SEGMENTS_BY_STRUCTURE[config.payoutStructure ?? "final_only"];
  if (!allowedSegments.includes(segment)) {
    throw new Error(`${segment} is not a configured segment for this module`);
  }

  await drawSquaresCore({ orgId, moduleId, segment, actor: userId });

  revalidatePath(
    `/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${moduleId}`,
  );
  revalidatePath(`/play/${orgSlug}/${fundraiserSlug}/${moduleId}`);
}
