import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Bypasses RLS entirely (build spec rule 4: "the service-role key is used
// only in server contexts that explicitly need it, and never reaches the
// browser"). Use for: writing to tables with no client INSERT policy
// (transactions, audit_log, stripe_webhook_events, participants) and for
// reading across orgs (there is none of that yet in Phase 1 app code, but
// don't add it without a real reason — every other read should go through
// the normal RLS-scoped client).
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
