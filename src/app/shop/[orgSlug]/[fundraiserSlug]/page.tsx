import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ShopCart } from "@/components/payments/shop-cart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ShopPage({
  params,
}: {
  params: Promise<{ orgSlug: string; fundraiserSlug: string }>;
}) {
  const { orgSlug, fundraiserSlug } = await params;

  // Anon-capable client — db/migrations/0007_phase2_policies.sql is what
  // makes this readable for a signed-out guest, same shape as the donate
  // page's public policy.
  const supabase = await createClient();
  const { data: fundraiser } = await supabase
    .from("fundraisers")
    .select("id, title, status, organizations!inner(name, slug, charges_enabled)")
    .eq("slug", fundraiserSlug)
    .eq("organizations.slug", orgSlug)
    .maybeSingle();

  const org = fundraiser
    ? Array.isArray(fundraiser.organizations)
      ? fundraiser.organizations[0]
      : fundraiser.organizations
    : null;
  if (!fundraiser || !org || fundraiser.status !== "active") notFound();

  const { data: productModule } = await supabase
    .from("modules")
    .select("id")
    .eq("fundraiser_id", fundraiser.id)
    .eq("type", "product")
    .eq("status", "active")
    .maybeSingle();

  const { data: products } = productModule
    ? await supabase
        .from("products")
        .select("id, name, description, price_cents")
        .eq("module_id", productModule.id)
        .eq("status", "active")
        .order("created_at", { ascending: true })
    : { data: [] };

  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{fundraiser.title}</CardTitle>
          <p className="text-sm text-muted-foreground">{org.name}</p>
        </CardHeader>
        <CardContent>
          {!org.charges_enabled ? (
            <p className="text-sm text-destructive">
              This organization isn&apos;t able to accept payments yet.
            </p>
          ) : !products?.length ? (
            <p className="text-sm text-muted-foreground">No products available.</p>
          ) : null}
        </CardContent>
      </Card>

      {org.charges_enabled && products && products.length > 0 && (
        <ShopCart orgSlug={orgSlug} fundraiserSlug={fundraiserSlug} products={products} />
      )}
    </div>
  );
}
