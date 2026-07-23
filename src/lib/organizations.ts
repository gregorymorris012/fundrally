import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function createOrganization(input: {
  name: string;
  slug: string;
  stateCode: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_organization", {
    p_name: input.name,
    p_slug: input.slug,
    p_state_code: input.stateCode,
  });

  if (error) throw error;
  return data as string;
}
