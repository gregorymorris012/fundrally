import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createModule } from "@/lib/modules";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MODULE_TYPE_LABELS: Record<string, string> = {
  product: "Product sale",
  squares: "Squares",
  fifty_fifty: "50/50",
  item_raffle: "Item raffle",
  wheel: "Prize wheel",
  auction: "Auction",
  golf: "Golf outing",
};

// Split out of the fundraiser landing page: the module list and the
// "Create module" form used to live there directly.
export default async function ModulesIndexPage({
  params,
}: {
  params: Promise<{ orgSlug: string; fundraiserSlug: string }>;
}) {
  const { orgSlug, fundraiserSlug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, slug")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (!org) notFound();

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) notFound();
  const isAdmin = membership.role === "owner" || membership.role === "admin";

  const { data: fundraiser } = await supabase
    .from("fundraisers")
    .select("id, title")
    .eq("org_id", org.id)
    .eq("slug", fundraiserSlug)
    .maybeSingle();
  if (!fundraiser) notFound();

  const { data: fundraiserModules } = await supabase
    .from("modules")
    .select("id, type, status")
    .eq("fundraiser_id", fundraiser.id)
    .order("created_at", { ascending: true });

  // Which chance-based module types this org has enabled (CLAUDE.md
  // "Current deviations from the build spec") — drives which types show
  // up as creatable below. Product is always creatable; it predates
  // module_availability entirely.
  const { data: availabilityRows } = await supabase
    .from("module_availability")
    .select("module_type, enabled")
    .eq("org_id", org.id)
    .eq("enabled", true);
  const enabledChanceTypes = new Set(
    (availabilityRows ?? []).map((r) => r.module_type),
  );
  const hasProductModule = (fundraiserModules ?? []).some(
    (m) => m.type === "product",
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Fundraising Modules
        </h1>
        <Link
          href={`/org/${orgSlug}/fundraisers/${fundraiserSlug}`}
          className="text-sm text-muted-foreground underline"
        >
          Back to {fundraiser.title}
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Modules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {fundraiserModules?.length ? (
            fundraiserModules.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <span>
                  {MODULE_TYPE_LABELS[m.type] ?? m.type}{" "}
                  <span className="text-muted-foreground">({m.status})</span>
                </span>
                <Link
                  href={`/org/${orgSlug}/fundraisers/${fundraiserSlug}/modules/${m.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Manage
                </Link>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No modules yet.</p>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Create module</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createModule} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="orgId" value={org.id} />
              <input type="hidden" name="fundraiserId" value={fundraiser.id} />
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
              <div className="space-y-1.5">
                <Label htmlFor="type">Type</Label>
                <select
                  id="type"
                  name="type"
                  required
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {!hasProductModule && <option value="product">Product sale</option>}
                  {[...enabledChanceTypes].map((type) => (
                    <option key={type} value={type}>
                      {MODULE_TYPE_LABELS[type] ?? type} (demo mode)
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">Create</Button>
            </form>
            {enabledChanceTypes.size === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Chance-based module types (squares, 50/50, item raffle, prize
                wheel) show up here once an admin enables them for this
                organization on the org dashboard.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
