import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createProductModule } from "@/lib/modules";
import { createProduct } from "@/lib/products";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function FundraiserAdminPage({
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
    .select("id, title, slug")
    .eq("org_id", org.id)
    .eq("slug", fundraiserSlug)
    .maybeSingle();
  if (!fundraiser) notFound();

  const { data: productModule } = await supabase
    .from("modules")
    .select("id")
    .eq("fundraiser_id", fundraiser.id)
    .eq("type", "product")
    .maybeSingle();

  const { data: products } = productModule
    ? await supabase
        .from("products")
        .select("id, name, price_cents, status")
        .eq("module_id", productModule.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  const { data: orders } = productModule
    ? await supabase
        .from("orders")
        .select(
          "id, status, created_at, participants(display_name, email), order_items(quantity, unit_price_cents, products(name))",
        )
        .eq("module_id", productModule.id)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{fundraiser.title}</h1>
        <Link href={`/org/${orgSlug}`} className="text-sm text-muted-foreground underline">
          Back to organization
        </Link>
      </div>

      {!productModule ? (
        isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Product sale</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createProductModule}>
                <input type="hidden" name="orgId" value={org.id} />
                <input type="hidden" name="fundraiserId" value={fundraiser.id} />
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                <Button type="submit">Enable product sale</Button>
              </form>
            </CardContent>
          </Card>
        )
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Shop</CardTitle>
            </CardHeader>
            <CardContent>
              <a
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={`/shop/${orgSlug}/${fundraiserSlug}`}
              >
                View public shop page
              </a>
            </CardContent>
          </Card>

          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Add product</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={createProduct} className="space-y-3">
                  <input type="hidden" name="orgId" value={org.id} />
                  <input type="hidden" name="moduleId" value={productModule.id} />
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="fundraiserSlug" value={fundraiserSlug} />
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" name="name" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="description">Description</Label>
                    <Input id="description" name="description" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="price">Price (USD)</Label>
                    <Input id="price" name="price" type="number" min="0.01" step="0.01" required />
                  </div>
                  <Button type="submit">Add product</Button>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Products</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {products?.length ? (
                products.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span>{p.name}</span>
                    <span className="text-muted-foreground">
                      ${(p.price_cents / 100).toFixed(2)} ({p.status})
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No products yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Orders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {orders?.length ? (
                orders.map((order) => {
                  const items = Array.isArray(order.order_items) ? order.order_items : [];
                  const totalCents = items.reduce(
                    (sum, item) => sum + item.quantity * item.unit_price_cents,
                    0,
                  );
                  const participant = Array.isArray(order.participants)
                    ? order.participants[0]
                    : order.participants;
                  return (
                    <div key={order.id} className="text-sm">
                      <div className="flex items-center justify-between">
                        <span>{participant?.display_name ?? "Guest"}</span>
                        <span className="text-muted-foreground">
                          ${(totalCents / 100).toFixed(2)} ({order.status})
                        </span>
                      </div>
                      <p className="text-muted-foreground">
                        {items
                          .map((item) => {
                            const product = Array.isArray(item.products)
                              ? item.products[0]
                              : item.products;
                            return `${item.quantity}x ${product?.name ?? "item"}`;
                          })
                          .join(", ")}
                      </p>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">No orders yet.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
